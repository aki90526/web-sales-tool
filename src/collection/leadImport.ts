import { LeadType, SHEETS } from "../domain/lead";
import { appendAnalysisData } from "../google/analysisDataRepository";
import { appendSalesLead } from "../google/salesLeadRepository";
import { readSalesManagementTable } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";
import { LeadCandidate, toSalesLeadInput } from "../openai/leadCandidateCollector";
import { WebSearchTrace } from "../openai/openAIClient";
import { verifyCompanyName } from "./companyNameVerifier";
import { checkFormPresence, excludeRequestOnlyForm, verifyContactUrl, verifyContactUrlTarget } from "./contactUrlVerifier";
import { findEmailOnSite } from "./emailFinder";
import { scoreThresholdForLeadType } from "../domain/scoring";

export type ExistingLeadState = {
  maxNumericLeadId: number;
  companies: string[];
  siteUrls: string[];
  // 登録済みのリード（source: "lead"）と、「除外リスト」シートの会社（source: "exclusionList"）。AIへの除外リストには、検索エリアに合うリードと、除外リストシートの会社を使う
  entries: Array<{ company: string; url: string; region: string; status: string; source: "lead" | "exclusionList" }>;
};

export type ImportedLeadResult = {
  leadId: string;
  companyName: string;
  companyNameCorrection?: string;
  contactUrlCorrection?: string;
  emailFound?: string;
  contactUrlWarning?: string;
  range?: string;
  analysisDataRange?: string;
  rowNumber: number;
};

export type LeadImportContext = {
  searchCondition?: string;
  autoRejectLowScore?: boolean;
  searchTrace?: WebSearchTrace;
  acquiredAt?: string;
};

// 「除外リスト」シート（リードID・企業名・公式サイトURL・ステータス・次回対応日・メモ）の行から、除外する会社とURLを取り出す。
// 営業管理に登録していない会社を、検索結果に出さないために使う（企業名かURLのどちらかがあればよい）
export const parseExclusionListRows = (rows: unknown[][]): Array<{ company: string; url: string }> => {
  const cell = (row: unknown[], index: number): string => String(row[index] ?? "").trim();

  return rows
    .slice(1)
    .map((row) => ({ company: cell(row, 1), url: cell(row, 2) }))
    .filter((entry) => entry.company || entry.url);
};

const readExclusionList = async (sheets: SheetsClient): Promise<Array<{ company: string; url: string }>> => {
  try {
    return parseExclusionListRows(await sheets.getValues(`'${SHEETS.exclusionList}'!A:F`));
  } catch {
    // シートが無い場合は、除外リストなしとして扱う
    return [];
  }
};

export const readExistingLeadState = async (sheets: SheetsClient): Promise<ExistingLeadState> => {
  const table = await readSalesManagementTable(sheets);
  const companies: string[] = [];
  const siteUrls: string[] = [];
  const entries: ExistingLeadState["entries"] = [];
  let maxNumericLeadId = 0;

  for (const lead of table.leads) {
    const leadId = lead.leadId;
    const numericMatch = /^L-(\d+)$/.exec(leadId);

    if (numericMatch) {
      maxNumericLeadId = Math.max(maxNumericLeadId, Number(numericMatch[1]));
    }

    if (lead.companyName) {
      companies.push(lead.companyName);
    }

    if (lead.officialSiteUrl) {
      siteUrls.push(lead.officialSiteUrl);
    }

    entries.push({ company: lead.companyName, url: lead.officialSiteUrl, region: lead.region, status: lead.status, source: "lead" });
  }

  // 「除外リスト」シートの会社は、重複の判定にも、AIへの除外リストにも使う（エリアは問わない）
  for (const excluded of await readExclusionList(sheets)) {
    if (excluded.company) {
      companies.push(excluded.company);
    }

    if (excluded.url) {
      siteUrls.push(excluded.url);
    }

    entries.push({ company: excluded.company, url: excluded.url, region: "", status: "除外", source: "exclusionList" });
  }

  return {
    maxNumericLeadId,
    companies,
    siteUrls,
    entries
  };
};

export const leadKey = (value: string): string => {
  return value.trim().toLowerCase().replace(/\/$/, "");
};

export const filterUniqueCandidates = (
  candidates: LeadCandidate[],
  existing: ExistingLeadState
): LeadCandidate[] => {
  const seenCompanies = new Set(existing.companies.map(leadKey));
  const seenSiteUrls = new Set(existing.siteUrls.map(leadKey));

  return candidates.filter((candidate) => {
    const companyKey = leadKey(candidate.companyName);
    const siteUrlKey = leadKey(candidate.officialSiteUrl);

    if (seenCompanies.has(companyKey) || seenSiteUrls.has(siteUrlKey)) {
      return false;
    }

    seenCompanies.add(companyKey);
    seenSiteUrls.add(siteUrlKey);
    return true;
  });
};

export const nextLeadId = (numericId: number): string => {
  return `L-${String(numericId).padStart(4, "0")}`;
};

export const importLeadCandidates = async (
  sheets: SheetsClient,
  candidates: LeadCandidate[],
  context: LeadImportContext = {}
): Promise<ImportedLeadResult[]> => {
  const existing = await readExistingLeadState(sheets);
  const uniqueCandidates = filterUniqueCandidates(candidates, existing);
  const results: ImportedLeadResult[] = [];
  let nextNumericId = existing.maxNumericLeadId + 1;

  for (const candidate of uniqueCandidates) {
    const leadId = nextLeadId(nextNumericId);
    const verification = await verifyCompanyName(candidate);
    const contactVerification = await verifyContactUrl(verification.candidate);
    const targetCheck = await verifyContactUrlTarget(contactVerification.candidate);
    const requestOnlyCheck = await excludeRequestOnlyForm(targetCheck.candidate);
    let verifiedCandidate = requestOnlyCheck.candidate;
    let foundEmailSource = "";
    const formPresence = await checkFormPresence(verifiedCandidate.contactUrl);

    if (formPresence.warning) {
      verifiedCandidate = {
        ...verifiedCandidate,
        memo: [verifiedCandidate.memo, `要確認: ${formPresence.warning}`].filter(Boolean).join("\n")
      };
    }

    // メール送信を優先するため、メールアドレスが未取得なら公式サイト等から探す
    if (!verifiedCandidate.email) {
      const found = await findEmailOnSite(verifiedCandidate.officialSiteUrl, verifiedCandidate.contactUrl);

      if (found) {
        foundEmailSource = found.sourceUrl;
        const reviveStatus =
          verifiedCandidate.status === "見送り" &&
          verifiedCandidate.recommendedApproach !== "見送り" &&
          !verifiedCandidate.exclusionReason &&
          (context.autoRejectLowScore === false ||
            verifiedCandidate.salesScore >= scoreThresholdForLeadType(verifiedCandidate.leadType));

        verifiedCandidate = {
          ...verifiedCandidate,
          email: found.email,
          status: reviveStatus ? "送信待ち" : verifiedCandidate.status,
          memo: [verifiedCandidate.memo, `メール出典（自動取得）: ${found.sourceUrl}`].filter(Boolean).join("\n")
        };
      }
    }
    const lead = toSalesLeadInput(verifiedCandidate, leadId);
    const result = await appendSalesLead(sheets, lead);
    const analysisDataResult = await appendAnalysisData(sheets, {
      leadId,
      targetUrl: lead.officialSiteUrl,
      acquiredAt: context.acquiredAt ?? new Date().toISOString(),
      pageType: verifiedCandidate.pageType,
      analyzedAt: context.acquiredAt ?? new Date().toISOString(),
      mobileResponsive: verifiedCandidate.mobileResponsive,
      seoBasics: verifiedCandidate.seoBasics,
      cta: verifiedCandidate.cta,
      contactFlow: verifiedCandidate.contactFlow,
      updateStatus: verifiedCandidate.updateStatus,
      ssl: verifiedCandidate.ssl,
      cms: verifiedCandidate.cms,
      improvementPoints: verifiedCandidate.improvementPoints,
      recommendedApproach: verifiedCandidate.recommendedApproach,
      estimatedRenewalPeriod: verifiedCandidate.estimatedRenewalPeriod,
      renewalConfidence: verifiedCandidate.renewalConfidence,
      renewalEvidence: verifiedCandidate.renewalEvidence,
      aiAnalysis: verifiedCandidate.aiAnalysis,
      aiAdjustment: verifiedCandidate.aiAdjustment,
      aiAdjustmentReason: verifiedCandidate.aiAdjustmentReason,
      baseScore: verifiedCandidate.baseScore,
      salesScore: verifiedCandidate.salesScore,
      scoreBreakdown: verifiedCandidate.scoreBreakdown,
      exclusionReason: verifiedCandidate.exclusionReason,
      searchCondition: context.searchCondition ?? "",
      searchQueries: context.searchTrace?.queries ?? [],
      sourceUrls: context.searchTrace?.sourceUrls ?? [],
      capital: verifiedCandidate.capital,
      employeeCount: verifiedCandidate.employeeCount,
      annualRevenue: verifiedCandidate.annualRevenue,
      listingStatus: verifiedCandidate.listingStatus,
      companySizeCategory: verifiedCandidate.companySizeCategory,
      companySizeMemo: verifiedCandidate.companySizeMemo,
      salesAngle: verifiedCandidate.salesAngle
    });

    results.push({
      leadId,
      companyName: lead.companyName,
      companyNameCorrection: verification.correction
        ? `${verification.correction.from} -> ${verification.correction.to} (${verification.correction.sourceUrl})`
        : undefined,
      contactUrlCorrection: targetCheck.note
        ? targetCheck.note
        : requestOnlyCheck.replaced
        ? `${requestOnlyCheck.replaced.from} -> ${requestOnlyCheck.replaced.to} (依頼・予約専用フォームのため一般の問い合わせページへ差し替え)`
        : requestOnlyCheck.excluded
        ? `除外: ${requestOnlyCheck.excluded.url} (${requestOnlyCheck.excluded.reason})`
        : contactVerification.correction
        ? `${contactVerification.correction.from} -> ${contactVerification.correction.to} (${contactVerification.correction.reason})`
        : undefined,
      contactUrlWarning: formPresence.warning,
      emailFound: foundEmailSource ? `${verifiedCandidate.email} (${foundEmailSource})` : undefined,
      range: result.range,
      analysisDataRange: analysisDataResult.range,
      rowNumber: result.rowNumber
    });

    nextNumericId += 1;
  }

  return results;
};

export const formatTargetTypes = (targetTypes: LeadType[]): string => {
  return targetTypes.join(", ");
};
