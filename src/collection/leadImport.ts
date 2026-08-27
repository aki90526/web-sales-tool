import { LeadType, SHEETS } from "../domain/lead";
import { appendAnalysisData } from "../google/analysisDataRepository";
import { appendSalesLead } from "../google/salesLeadRepository";
import { SheetsClient } from "../google/sheetsClient";
import { LeadCandidate, toSalesLeadInput } from "../openai/leadCandidateCollector";
import { WebSearchTrace } from "../openai/openAIClient";

export type ExistingLeadState = {
  maxNumericLeadId: number;
  companies: string[];
  siteUrls: string[];
};

export type ImportedLeadResult = {
  leadId: string;
  companyName: string;
  range?: string;
  analysisDataRange?: string;
  rowNumber: number;
};

export type LeadImportContext = {
  searchCondition?: string;
  searchTrace?: WebSearchTrace;
  acquiredAt?: string;
};

export const readExistingLeadState = async (sheets: SheetsClient): Promise<ExistingLeadState> => {
  const values = await sheets.getValues(`'${SHEETS.salesManagement}'!A2:F1000`);
  const companies: string[] = [];
  const siteUrls: string[] = [];
  let maxNumericLeadId = 0;

  for (const row of values) {
    const leadId = String(row[0] ?? "").trim();
    const numericMatch = /^L-(\d+)$/.exec(leadId);
    const company = String(row[1] ?? "").trim();
    const siteUrl = String(row[5] ?? "").trim();

    if (numericMatch) {
      maxNumericLeadId = Math.max(maxNumericLeadId, Number(numericMatch[1]));
    }

    if (company) {
      companies.push(company);
    }

    if (siteUrl) {
      siteUrls.push(siteUrl);
    }
  }

  return {
    maxNumericLeadId,
    companies,
    siteUrls
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
    const lead = toSalesLeadInput(candidate, leadId);
    const result = await appendSalesLead(sheets, lead);
    const analysisDataResult = await appendAnalysisData(sheets, {
      leadId,
      targetUrl: lead.officialSiteUrl,
      acquiredAt: context.acquiredAt ?? new Date().toISOString(),
      pageType: candidate.pageType,
      analyzedAt: context.acquiredAt ?? new Date().toISOString(),
      mobileResponsive: candidate.mobileResponsive,
      seoBasics: candidate.seoBasics,
      cta: candidate.cta,
      contactFlow: candidate.contactFlow,
      updateStatus: candidate.updateStatus,
      ssl: candidate.ssl,
      cms: candidate.cms,
      improvementPoints: candidate.improvementPoints,
      estimatedRenewalPeriod: candidate.estimatedRenewalPeriod,
      renewalConfidence: candidate.renewalConfidence,
      renewalEvidence: candidate.renewalEvidence,
      aiAnalysis: candidate.aiAnalysis,
      aiAdjustment: candidate.aiAdjustment,
      aiAdjustmentReason: candidate.aiAdjustmentReason,
      baseScore: candidate.baseScore,
      salesScore: candidate.salesScore,
      scoreBreakdown: candidate.scoreBreakdown,
      exclusionReason: candidate.exclusionReason,
      searchCondition: context.searchCondition ?? "",
      searchQueries: context.searchTrace?.queries ?? [],
      sourceUrls: context.searchTrace?.sourceUrls ?? [],
      capital: candidate.capital,
      employeeCount: candidate.employeeCount,
      annualRevenue: candidate.annualRevenue,
      listingStatus: candidate.listingStatus,
      companySizeCategory: candidate.companySizeCategory,
      companySizeMemo: candidate.companySizeMemo
    });

    results.push({
      leadId,
      companyName: lead.companyName,
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
