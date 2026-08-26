import {
  CompanySizeCategory,
  COMPANY_SIZE_CATEGORIES,
  LeadType,
  LEAD_TYPES,
  ListingStatus,
  LISTING_STATUSES,
  ProposalType,
  PROPOSAL_TYPES,
  SalesLeadInput
} from "../domain/lead";
import { extractOutputText, OpenAIClient } from "./openAIClient";

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
  salesScore: number;
  proposalType: ProposalType;
  salesMessageDraft: string;
  memo: string;
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

const isLeadType = (value: unknown): value is LeadType => {
  return LEAD_TYPES.includes(value as LeadType);
};

const isProposalType = (value: unknown): value is ProposalType => {
  return PROPOSAL_TYPES.includes(value as ProposalType);
};

const isListingStatus = (value: unknown): value is ListingStatus => {
  return LISTING_STATUSES.includes(value as ListingStatus);
};

const isCompanySizeCategory = (value: unknown): value is CompanySizeCategory => {
  return COMPANY_SIZE_CATEGORIES.includes(value as CompanySizeCategory);
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

const normalizeScore = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return 50;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
};

export const normalizeLeadCandidate = (value: unknown): LeadCandidate | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const companyName = text(record.companyName, 200);
  const leadType = record.leadType;
  const proposalType = record.proposalType;
  const officialSiteUrl = normalizeUrl(record.officialSiteUrl);

  if (!companyName || !isLeadType(leadType) || !isProposalType(proposalType) || !officialSiteUrl) {
    return null;
  }

  return {
    companyName,
    leadType,
    industry: text(record.industry, 200),
    region: text(record.region, 200),
    officialSiteUrl,
    contactUrl: normalizeUrl(record.contactUrl),
    email: text(record.email, 200),
    siteAnalysisSummary: text(record.siteAnalysisSummary),
    improvementPoints: text(record.improvementPoints),
    salesScore: normalizeScore(record.salesScore),
    proposalType,
    salesMessageDraft: text(record.salesMessageDraft, 2500),
    memo: text(record.memo, 600),
    capital: text(record.capital, 120),
    employeeCount: text(record.employeeCount, 120),
    annualRevenue: text(record.annualRevenue, 120),
    listingStatus: isListingStatus(record.listingStatus) ? record.listingStatus : "不明",
    companySizeCategory: isCompanySizeCategory(record.companySizeCategory)
      ? record.companySizeCategory
      : "不明",
    companySizeMemo: text(record.companySizeMemo, 600)
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
    "目的: aaWebCreate（春日部市のフリーランスWeb制作者）が、Web制作会社・広告代理店には外部パートナー提案、直クライアントにはWebサイト改善提案を行うための営業候補を作る。",
    "優先条件: 公式サイトURLが確認できる、問い合わせフォームまたはメールがある、Web制作/WordPress/フロントエンド/Shopify/保守運用の提案余地がある。",
    "直クライアントの規模判定: 上場企業、全国展開、大企業、資本金1億円以上、従業員300名以上などは大規模として営業優先度を下げる。地域密着、中小企業、店舗、士業、工務店、クリニック、専門サービスは優先する。",
    "Web制作会社・広告代理店の規模判定: 大規模でも外部パートナー募集や制作外注余地があれば候補にしてよい。",
    "除外条件: 採用媒体だけの情報、公式サイトが見つからない企業、既存候補と重複する企業、同業フリーランス個人のみのサイト。",
    `既存候補の企業名: ${excludedCompanies}`,
    `既存候補のURL: ${excludedUrls}`,
    "返答はJSON配列のみ。Markdown、説明文、引用マーカーは不要。",
    "各要素のキーは必ず次の通りにしてください:",
    "companyName, leadType, industry, region, officialSiteUrl, contactUrl, email, siteAnalysisSummary, improvementPoints, salesScore, proposalType, salesMessageDraft, memo, capital, employeeCount, annualRevenue, listingStatus, companySizeCategory, companySizeMemo",
    `leadType は次のいずれかのみ: ${LEAD_TYPES.join(", ")}`,
    `proposalType は次のいずれかのみ: ${PROPOSAL_TYPES.join(", ")}`,
    `listingStatus は次のいずれかのみ: ${LISTING_STATUSES.join(", ")}`,
    `companySizeCategory は次のいずれかのみ: ${COMPANY_SIZE_CATEGORIES.join(", ")}`,
    "salesScore は0〜100の整数。contactUrl は問い合わせフォームURLが不明なら空文字。email は不明なら空文字。",
    "資本金、従業員数、売上高は公式サイトや信頼できる会社情報で確認できた場合のみ入れ、不明なら空文字にしてください。",
    "直クライアントが大規模の場合、salesScore は原則60以下にしてください。",
    "salesMessageDraft は日本語で、送信前に人間が確認する前提の簡潔な下書きにしてください。"
  ].join("\n");
};

export const collectLeadCandidates = async (
  openAI: OpenAIClient,
  options: CollectLeadCandidateOptions
): Promise<LeadCandidate[]> => {
  const response = await openAI.createWebSearchResponse(buildPrompt(options));
  const parsed = extractJsonArray(extractOutputText(response));

  if (!Array.isArray(parsed)) {
    throw new Error("OpenAI response JSON was not an array");
  }

  return parsed
    .map(normalizeLeadCandidate)
    .filter((candidate): candidate is LeadCandidate => candidate !== null)
    .slice(0, options.limit);
};

export const toSalesLeadInput = (
  candidate: LeadCandidate,
  leadId: string,
  updatedAt: string
): SalesLeadInput => {
  return {
    leadId,
    companyName: candidate.companyName,
    leadType: candidate.leadType,
    industry: candidate.industry,
    region: candidate.region,
    officialSiteUrl: candidate.officialSiteUrl,
    source: `OpenAI web_search ${updatedAt}`,
    contactUrl: candidate.contactUrl,
    email: candidate.email,
    siteAnalysisSummary: candidate.siteAnalysisSummary,
    improvementPoints: candidate.improvementPoints,
    salesScore: candidate.salesScore,
    proposalType: candidate.proposalType,
    salesMessageDraft: candidate.salesMessageDraft,
    reviewStatus: "未確認",
    sendPermission: "未判定",
    sendStatus: "未送信",
    replyStatus: "未返信",
    excludeFlag: false,
    excludeReason: "",
    updatedAt,
    memo: candidate.memo,
    capital: candidate.capital,
    employeeCount: candidate.employeeCount,
    annualRevenue: candidate.annualRevenue,
    listingStatus: candidate.listingStatus,
    companySizeCategory: candidate.companySizeCategory,
    companySizeMemo: candidate.companySizeMemo
  };
};
