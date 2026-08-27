import {
  COMPANY_SIZE_CATEGORIES,
  CompanySizeCategory,
  ContactMethod,
  LeadType,
  LEAD_TYPES,
  LISTING_STATUSES,
  ListingStatus,
  PROPOSAL_TYPES,
  ProposalType,
  RecommendedApproach,
  RECOMMENDED_APPROACHES,
  SalesLeadInput,
  Status
} from "../domain/lead";
import {
  calculateSalesScore,
  RENEWAL_CONFIDENCES,
  RENEWAL_PERIODS,
  RenewalConfidence,
  RenewalPeriod,
  ScoreSignals
} from "../domain/scoring";
import { extractOutputText, extractWebSearchTrace, OpenAIClient, WebSearchTrace } from "./openAIClient";

export type LeadCandidate = {
  companyName: string;
  leadType: LeadType;
  industry: string;
  region: string;
  officialSiteUrl: string;
  contactUrl: string;
  email: string;
  siteAnalysisSummary: string;
  improvementPoints: string;
  salesAngle: string;
  recommendedApproach: RecommendedApproach;
  salesMessageDraft: string;
  status: Status;
  memo: string;
  pageType: string;
  mobileResponsive: string;
  seoBasics: string;
  cta: string;
  contactFlow: string;
  updateStatus: string;
  ssl: string;
  cms: string;
  estimatedRenewalPeriod: RenewalPeriod;
  renewalConfidence: RenewalConfidence;
  renewalEvidence: string;
  aiAnalysis: string;
  aiAdjustment: number;
  aiAdjustmentReason: string;
  baseScore: number;
  salesScore: number;
  scoreBreakdown: Record<string, number>;
  scoreError: string;
  exclusionReason: string;
  scoreSignals: ScoreSignals;
  capital: string;
  employeeCount: string;
  annualRevenue: string;
  listingStatus: ListingStatus;
  companySizeCategory: CompanySizeCategory;
  companySizeMemo: string;
};

export type CollectLeadCandidateOptions = {
  area: string;
  targetTypes: LeadType[];
  limit: number;
  existingCompanies: string[];
  existingSiteUrls: string[];
};

export type LeadCandidateCollectionResult = {
  candidates: LeadCandidate[];
  searchTrace: WebSearchTrace;
};

const stripCitationMarkers = (value: string): string => {
  return value.replace(/【[^】]*†[^】]*】/g, "").replace(/cite[^]+/g, "");
};

const extractJsonArray = (text: string): unknown => {
  const cleaned = stripCitationMarkers(text).trim();
  const withoutFence = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = withoutFence.indexOf("[");
  const end = withoutFence.lastIndexOf("]");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`OpenAI response was not a JSON array: ${withoutFence.slice(0, 300)}`);
  }

  return JSON.parse(withoutFence.slice(start, end + 1));
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const isLeadType = (value: unknown): value is LeadType => {
  return LEAD_TYPES.includes(value as LeadType);
};

const isProposalType = (value: unknown): value is ProposalType => {
  return PROPOSAL_TYPES.includes(value as ProposalType);
};

const isRecommendedApproach = (value: unknown): value is RecommendedApproach => {
  return RECOMMENDED_APPROACHES.includes(value as RecommendedApproach);
};

const isListingStatus = (value: unknown): value is ListingStatus => {
  return LISTING_STATUSES.includes(value as ListingStatus);
};

const isCompanySizeCategory = (value: unknown): value is CompanySizeCategory => {
  return COMPANY_SIZE_CATEGORIES.includes(value as CompanySizeCategory);
};

const isRenewalPeriod = (value: unknown): value is RenewalPeriod => {
  return RENEWAL_PERIODS.includes(value as RenewalPeriod);
};

const isRenewalConfidence = (value: unknown): value is RenewalConfidence => {
  return RENEWAL_CONFIDENCES.includes(value as RenewalConfidence);
};

const text = (value: unknown, maxLength = 1200): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
};

const normalizeUrl = (value: unknown): string => {
  const url = text(value, 500);

  if (!url || !/^https?:\/\//i.test(url)) {
    return "";
  }

  return url;
};

const normalizeAiAdjustment = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(-10, Math.min(10, Math.round(numeric)));
};

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "yes", "1", "あり", "有"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "0", "なし", "無"].includes(normalized)) {
    return false;
  }

  return undefined;
};

const normalizeNumber = (value: unknown): number | undefined => {
  const numeric = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numeric) ? numeric : undefined;
};

const normalizeScoreSignals = (record: Record<string, unknown>): ScoreSignals => {
  const nested = isObject(record.scoreSignals) ? record.scoreSignals : {};
  const read = (key: string): unknown => {
    return nested[key] !== undefined ? nested[key] : record[key];
  };

  return {
    isOfficialSite: normalizeBoolean(read("isOfficialSite")),
    hasContactMethod: normalizeBoolean(read("hasContactMethod")),
    isTargetArea: normalizeBoolean(read("isTargetArea")),
    isWebProductionBusiness: normalizeBoolean(read("isWebProductionBusiness")),
    hasPartnerRecruiting: normalizeBoolean(read("hasPartnerRecruiting")),
    hasSubcontractorRecruiting: normalizeBoolean(read("hasSubcontractorRecruiting")),
    hasCoderRecruiting: normalizeBoolean(read("hasCoderRecruiting")),
    handlesWordPress: normalizeBoolean(read("handlesWordPress")),
    handlesShopify: normalizeBoolean(read("handlesShopify")),
    handlesMaintenance: normalizeBoolean(read("handlesMaintenance")),
    complementarityScore: normalizeNumber(read("complementarityScore")),
    noOutsourcingPolicy: normalizeBoolean(read("noOutsourcingPolicy")),
    lowCollaborationFit: normalizeBoolean(read("lowCollaborationFit")),
    hasMobileIssue: normalizeBoolean(read("hasMobileIssue")),
    hasWeakContactFlow: normalizeBoolean(read("hasWeakContactFlow")),
    hasWeakCta: normalizeBoolean(read("hasWeakCta")),
    hasSeoIssue: normalizeBoolean(read("hasSeoIssue")),
    hasStaleSite: normalizeBoolean(read("hasStaleSite")),
    hasWeakRecruitingPage: normalizeBoolean(read("hasWeakRecruitingPage")),
    hasUnclearService: normalizeBoolean(read("hasUnclearService")),
    hasOldDesign: normalizeBoolean(read("hasOldDesign")),
    forbidsSalesContact: normalizeBoolean(read("forbidsSalesContact")),
    forbidsAdsMail: normalizeBoolean(read("forbidsAdsMail")),
    pastOptOut: normalizeBoolean(read("pastOptOut")),
    reapproachForbidden: normalizeBoolean(read("reapproachForbidden")),
    notOfficialSite: normalizeBoolean(read("notOfficialSite")),
    excludedIndustry: normalizeBoolean(read("excludedIndustry"))
  };
};

const normalizeRenewalPeriod = (value: unknown): RenewalPeriod => {
  const raw = text(value, 80);

  if (isRenewalPeriod(raw)) {
    return raw;
  }

  if (/1年以内|一年以内|直近1年|within_?1/i.test(raw)) {
    return "1年以内";
  }

  if (/1.*3年|1〜3|1-3|one.*three/i.test(raw)) {
    return "1〜3年以内";
  }

  if (/3.*5年|3〜5|3-5|three.*five/i.test(raw)) {
    return "3〜5年以内";
  }

  if (/5年以上|五年以上|over_?5|older/i.test(raw)) {
    return "5年以上前";
  }

  return "不明";
};

const normalizeRenewalConfidence = (value: unknown): RenewalConfidence => {
  const raw = text(value, 20);

  return isRenewalConfidence(raw) ? raw : "不明";
};

const normalizeRecommendedApproach = (
  value: unknown,
  legacyProposalType: unknown,
  leadType: LeadType
): RecommendedApproach => {
  if (isRecommendedApproach(value)) {
    return value;
  }

  if (isProposalType(legacyProposalType)) {
    if (legacyProposalType === "LP制作提案") {
      return "LP制作";
    }

    if (legacyProposalType === "保守運用提案") {
      return "保守・更新";
    }

    if (legacyProposalType === "Webサイト改善提案") {
      return "部分改善";
    }

    return legacyProposalType;
  }

  return leadType === "直クライアント" ? "部分改善" : "外注先提案";
};

const pickContactMethod = (contactUrl: string, email: string): ContactMethod => {
  if (email) {
    return "メール";
  }

  if (contactUrl) {
    return "問い合わせフォーム";
  }

  return "未定";
};

export const normalizeLeadCandidate = (value: unknown): LeadCandidate | null => {
  if (!isObject(value)) {
    return null;
  }

  const companyName = text(value.companyName, 200);
  const leadType = value.leadType;
  const officialSiteUrl = normalizeUrl(value.officialSiteUrl);

  if (!companyName || !isLeadType(leadType) || !officialSiteUrl) {
    return null;
  }

  const contactUrl = normalizeUrl(value.contactUrl);
  const email = text(value.email, 200);
  const siteAnalysisSummary = text(value.siteAnalysisSummary || value.aiAnalysis);
  const improvementPoints = text(value.improvementPoints);
  const salesAngle = text(value.salesAngle || value.proposalType || improvementPoints, 800);
  const recommendedApproach = normalizeRecommendedApproach(
    value.recommendedApproach,
    value.proposalType,
    leadType
  );
  const aiAdjustment = normalizeAiAdjustment(value.aiAdjustment);
  const scoreSignals = normalizeScoreSignals(value);
  const listingStatus = isListingStatus(value.listingStatus) ? value.listingStatus : "不明";
  const companySizeCategory = isCompanySizeCategory(value.companySizeCategory)
    ? value.companySizeCategory
    : "不明";
  const estimatedRenewalPeriod = normalizeRenewalPeriod(value.estimatedRenewalPeriod);
  const aiAnalysis = text(value.aiAnalysis || siteAnalysisSummary);
  const aiAdjustmentReason = text(value.aiAdjustmentReason, 600);
  const companySizeMemo = text(value.companySizeMemo, 600);
  const score = calculateSalesScore({
    leadType,
    industry: text(value.industry, 200),
    region: text(value.region, 200),
    officialSiteUrl,
    contactUrl,
    email,
    siteAnalysisSummary,
    improvementPoints,
    salesAngle,
    recommendedApproach,
    estimatedRenewalPeriod,
    aiAnalysis,
    aiAdjustment,
    aiAdjustmentReason,
    listingStatus,
    companySizeCategory,
    companySizeMemo,
    exclusionReason: text(value.exclusionReason, 300),
    scoreSignals
  });

  return {
    companyName,
    leadType,
    industry: text(value.industry, 200),
    region: text(value.region, 200),
    officialSiteUrl,
    contactUrl,
    email,
    siteAnalysisSummary,
    improvementPoints,
    salesAngle,
    recommendedApproach,
    salesMessageDraft: text(value.salesMessageDraft, 2500),
    status: score.status,
    memo: text(value.memo, 600),
    pageType: text(value.pageType, 120) || "検索結果",
    mobileResponsive: text(value.mobileResponsive, 80) || "未確認",
    seoBasics: text(value.seoBasics, 80) || "未確認",
    cta: text(value.cta, 80) || "未確認",
    contactFlow: text(value.contactFlow, 80) || "未確認",
    updateStatus: text(value.updateStatus, 80) || "未確認",
    ssl: text(value.ssl, 80) || "未確認",
    cms: text(value.cms, 120),
    estimatedRenewalPeriod,
    renewalConfidence: normalizeRenewalConfidence(value.renewalConfidence),
    renewalEvidence: text(value.renewalEvidence, 800),
    aiAnalysis,
    aiAdjustment: score.aiAdjustment,
    aiAdjustmentReason,
    baseScore: score.baseScore,
    salesScore: score.salesScore,
    scoreBreakdown: score.scoreBreakdown,
    scoreError: score.scoreError,
    exclusionReason: score.exclusionReason,
    scoreSignals,
    capital: text(value.capital, 120),
    employeeCount: text(value.employeeCount, 120),
    annualRevenue: text(value.annualRevenue, 120),
    listingStatus,
    companySizeCategory,
    companySizeMemo
  };
};

const buildPrompt = (options: CollectLeadCandidateOptions): string => {
  const excludedCompanies = options.existingCompanies.slice(-80).join(" / ") || "なし";
  const excludedUrls = options.existingSiteUrls.slice(-80).join(" / ") || "なし";

  return [
    "あなたは日本のWeb制作営業リスト作成アシスタントです。必ずWeb検索を使い、実在する企業だけを抽出してください。",
    `対象地域: ${options.area}`,
    `対象種別: ${options.targetTypes.join(", ")}`,
    `候補件数: 最大${options.limit}件`,
    "目的: aaWebCreate（春日部市のフリーランスWeb制作者）が、制作会社・広告代理店には外部パートナー提案、直クライアントにはWebサイト改善提案を行うための営業候補を作る。",
    "重要: 営業スコアの最終計算はシステム側で行います。あなたは固定スコア用の判定材料、推奨アプローチ、AI補正だけを返してください。",
    "優先条件: 公式サイトURLが確認できる、問い合わせフォームまたはメールがある、Web制作/WordPress/フロントエンド/Shopify/保守運用の提案余地がある。",
    "制作会社・広告代理店: 外部パートナー募集、業務委託募集、コーダー・エンジニア募集、WordPress、Shopify、保守更新、協業余地を重視してください。企業規模が大きいだけで低評価にしないでください。",
    "直クライアント: サイト改善余地、問い合わせ導線、CTA、SEO、更新停止感、古いデザイン、採用改善、LP化余地を重視してください。上場企業・大規模企業・直近リニューアル済みは優先度を下げる判定材料を入れてください。",
    "除外条件: 営業目的の問い合わせ禁止、広告宣伝メール禁止、公式サイトではない、既存候補と重複、同業フリーランス個人のみのサイト、明確な対象外業種。",
    `既存候補の企業名: ${excludedCompanies}`,
    `既存候補のURL: ${excludedUrls}`,
    "返答はJSON配列のみ。Markdown、説明文、引用マーカーは不要。",
    "各要素のキーは必ず次の通りにしてください:",
    "companyName, leadType, industry, region, officialSiteUrl, contactUrl, email, siteAnalysisSummary, improvementPoints, salesAngle, recommendedApproach, salesMessageDraft, memo, pageType, mobileResponsive, seoBasics, cta, contactFlow, updateStatus, ssl, cms, estimatedRenewalPeriod, renewalConfidence, renewalEvidence, aiAnalysis, aiAdjustment, aiAdjustmentReason, exclusionReason, scoreSignals, capital, employeeCount, annualRevenue, listingStatus, companySizeCategory, companySizeMemo",
    `leadType は次のいずれかのみ: ${LEAD_TYPES.join(", ")}`,
    `recommendedApproach は次のいずれかのみ: ${RECOMMENDED_APPROACHES.join(", ")}`,
    `estimatedRenewalPeriod は次のいずれかのみ: ${RENEWAL_PERIODS.join(", ")}`,
    `renewalConfidence は次のいずれかのみ: ${RENEWAL_CONFIDENCES.join(", ")}`,
    `listingStatus は次のいずれかのみ: ${LISTING_STATUSES.join(", ")}`,
    `companySizeCategory は次のいずれかのみ: ${COMPANY_SIZE_CATEGORIES.join(", ")}`,
    "aiAdjustment は -10〜10 の整数。固定ロジックでは判断しづらい定性的な補正だけを入れてください。不明なら0。",
    "scoreSignals はJSONオブジェクトで、次のboolean/numberを可能な範囲で返してください:",
    "isOfficialSite, hasContactMethod, isTargetArea, isWebProductionBusiness, hasPartnerRecruiting, hasSubcontractorRecruiting, hasCoderRecruiting, handlesWordPress, handlesShopify, handlesMaintenance, complementarityScore, noOutsourcingPolicy, lowCollaborationFit, hasMobileIssue, hasWeakContactFlow, hasWeakCta, hasSeoIssue, hasStaleSite, hasWeakRecruitingPage, hasUnclearService, hasOldDesign, forbidsSalesContact, forbidsAdsMail, pastOptOut, reapproachForbidden, notOfficialSite, excludedIndustry",
    "contactUrl は問い合わせフォームURLが不明なら空文字。email は不明なら空文字。",
    "資本金、従業員数、売上高は公式サイトや信頼できる会社情報で確認できた場合のみ入れ、不明なら空文字。",
    "salesMessageDraft は日本語で、送信前に人間が確認する前提の簡潔な下書きにしてください。"
  ].join("\n");
};

export const collectLeadCandidateCollection = async (
  openAI: OpenAIClient,
  options: CollectLeadCandidateOptions
): Promise<LeadCandidateCollectionResult> => {
  const response = await openAI.createWebSearchResponse(buildPrompt(options));
  const parsed = extractJsonArray(extractOutputText(response));

  if (!Array.isArray(parsed)) {
    throw new Error("OpenAI response JSON was not an array");
  }

  const candidates = parsed
    .map(normalizeLeadCandidate)
    .filter((candidate): candidate is LeadCandidate => candidate !== null)
    .slice(0, options.limit);

  return {
    candidates,
    searchTrace: extractWebSearchTrace(response)
  };
};

export const collectLeadCandidates = async (
  openAI: OpenAIClient,
  options: CollectLeadCandidateOptions
): Promise<LeadCandidate[]> => {
  return (await collectLeadCandidateCollection(openAI, options)).candidates;
};

export const toSalesLeadInput = (candidate: LeadCandidate, leadId: string): SalesLeadInput => {
  const contactMethod = pickContactMethod(candidate.contactUrl, candidate.email);
  const memoParts = [
    candidate.memo,
    candidate.exclusionReason ? `除外理由: ${candidate.exclusionReason}` : "",
    candidate.scoreError ? `スコア計算エラー: ${candidate.scoreError}` : ""
  ].filter(Boolean);

  return {
    leadId,
    companyName: candidate.companyName,
    leadType: candidate.leadType,
    industry: candidate.industry,
    region: candidate.region,
    officialSiteUrl: candidate.officialSiteUrl,
    contactMethod,
    contactFormUrl: candidate.contactUrl,
    emailAddress: candidate.email,
    salesScore: candidate.salesScore,
    salesAngle: candidate.salesAngle,
    recommendedApproach: candidate.recommendedApproach,
    salesMessageDraft: candidate.salesMessageDraft,
    status: candidate.status,
    memo: memoParts.join("\n")
  };
};
