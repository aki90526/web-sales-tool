import {
  CompanySizeCategory,
  LeadType,
  ListingStatus,
  RecommendedApproach,
  Status
} from "./lead";

export const RENEWAL_PERIODS = [
  "不明",
  "1年以内",
  "1〜3年以内",
  "3〜5年以内",
  "5年以上前"
] as const;

export const RENEWAL_CONFIDENCES = ["不明", "低", "中", "高"] as const;

export type RenewalPeriod = (typeof RENEWAL_PERIODS)[number];
export type RenewalConfidence = (typeof RENEWAL_CONFIDENCES)[number];

export type ScoreSignals = {
  isOfficialSite?: boolean;
  hasContactMethod?: boolean;
  isTargetArea?: boolean;
  isWebProductionBusiness?: boolean;
  hasPartnerRecruiting?: boolean;
  hasSubcontractorRecruiting?: boolean;
  hasCoderRecruiting?: boolean;
  handlesWordPress?: boolean;
  handlesShopify?: boolean;
  handlesMaintenance?: boolean;
  complementarityScore?: number;
  noOutsourcingPolicy?: boolean;
  lowCollaborationFit?: boolean;
  hasMobileIssue?: boolean;
  hasWeakContactFlow?: boolean;
  hasWeakCta?: boolean;
  hasSeoIssue?: boolean;
  hasStaleSite?: boolean;
  hasWeakRecruitingPage?: boolean;
  hasUnclearService?: boolean;
  hasOldDesign?: boolean;
  forbidsSalesContact?: boolean;
  forbidsAdsMail?: boolean;
  pastOptOut?: boolean;
  reapproachForbidden?: boolean;
  notOfficialSite?: boolean;
  excludedIndustry?: boolean;
};

export type ScoreInput = {
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
  estimatedRenewalPeriod: RenewalPeriod;
  aiAnalysis: string;
  aiAdjustment: number;
  aiAdjustmentReason: string;
  listingStatus: ListingStatus;
  companySizeCategory: CompanySizeCategory;
  companySizeMemo: string;
  exclusionReason: string;
  scoreSignals: ScoreSignals;
};

export type ScoreResult = {
  baseScore: number;
  aiAdjustment: number;
  salesScore: number;
  scoreBreakdown: Record<string, number>;
  status: Status;
  exclusionReason: string;
  scoreError: string;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const finiteNumber = (value: unknown): number | null => {
  const numeric = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numeric) ? numeric : null;
};

const hasPattern = (text: string, patterns: RegExp[]): boolean => {
  return patterns.some((pattern) => pattern.test(text));
};

const hasSignal = (
  explicit: boolean | undefined,
  text: string,
  patterns: RegExp[]
): boolean => {
  if (explicit === true) {
    return true;
  }

  if (explicit === false) {
    return false;
  }

  return hasPattern(text, patterns);
};

const buildText = (input: ScoreInput): string => {
  return [
    input.industry,
    input.region,
    input.siteAnalysisSummary,
    input.improvementPoints,
    input.estimatedRenewalPeriod,
    input.aiAnalysis,
    input.companySizeMemo
  ].join(" ");
};

const getExclusionReason = (input: ScoreInput, text: string): string => {
  if (input.exclusionReason.trim()) {
    return input.exclusionReason.trim();
  }

  if (input.scoreSignals.notOfficialSite) {
    return "公式サイトではない";
  }

  if (input.scoreSignals.pastOptOut || input.scoreSignals.reapproachForbidden) {
    return "配信停止または再営業禁止";
  }

  if (input.scoreSignals.excludedIndustry) {
    return "除外業種";
  }

  const forbidsSales = hasSignal(input.scoreSignals.forbidsSalesContact, text, [
    /営業(目的|メール|連絡).{0,12}(禁止|お断り|不可)/,
    /(セールス|売り込み).{0,12}(禁止|お断り|不可)/,
    /お問い合わせフォーム.{0,20}営業.{0,12}(禁止|お断り|不可)/
  ]);

  if (forbidsSales) {
    return "営業目的の問い合わせ禁止";
  }

  const forbidsAdsMail = hasSignal(input.scoreSignals.forbidsAdsMail, text, [
    /(広告|宣伝).{0,8}(メール|連絡).{0,12}(禁止|お断り|不可)/,
    /広告宣伝メール.{0,12}(禁止|お断り|不可)/
  ]);

  if (forbidsAdsMail) {
    return "広告宣伝メール禁止";
  }

  return "";
};

const directRenewalPenalty = (period: RenewalPeriod): number => {
  if (period === "1年以内") {
    return -30;
  }

  if (period === "1〜3年以内") {
    return -20;
  }

  if (period === "3〜5年以内") {
    return -5;
  }

  return 0;
};

const add = (
  breakdown: Record<string, number>,
  key: string,
  value: number,
  enabled: boolean
): number => {
  if (!enabled || value === 0) {
    return 0;
  }

  breakdown[key] = value;
  return value;
};

const calculateComplementarityScore = (
  input: ScoreInput,
  text: string
): number => {
  const explicit = finiteNumber(input.scoreSignals.complementarityScore);

  if (explicit !== null) {
    return clamp(Math.round(explicit), 0, 15);
  }

  let score = 0;

  if (hasPattern(text, [/コーディング|HTML|CSS|フロントエンド|JavaScript|TypeScript/i])) {
    score += 5;
  }

  if (hasPattern(text, [/WordPress|ワードプレス|CMS/i])) {
    score += 5;
  }

  if (hasPattern(text, [/Shopify|ECサイト|ネットショップ/i])) {
    score += 5;
  }

  if (hasPattern(text, [/保守|更新|運用|既存サイト改修|改修/i])) {
    score += 5;
  }

  return clamp(score, 0, 15);
};

const calculateAgencyBaseScore = (
  input: ScoreInput,
  text: string,
  breakdown: Record<string, number>
): number => {
  let score = 0;

  score += add(breakdown, "officialWebsite", 10, Boolean(input.officialSiteUrl));
  score += add(breakdown, "contactMethod", 10, Boolean(input.contactUrl || input.email));
  score += add(
    breakdown,
    "webProductionBusiness",
    10,
    hasSignal(input.scoreSignals.isWebProductionBusiness, text, [
      /Web制作|ホームページ制作|サイト制作|LP制作|Webデザイン|広告運用|Webマーケティング/
    ])
  );
  score += add(
    breakdown,
    "partnerRecruiting",
    30,
    hasSignal(input.scoreSignals.hasPartnerRecruiting, text, [
      /パートナー募集|制作パートナー|協力会社募集|ビジネスパートナー/
    ])
  );
  score += add(
    breakdown,
    "subcontractorRecruiting",
    25,
    hasSignal(input.scoreSignals.hasSubcontractorRecruiting, text, [
      /業務委託|外注|委託|下請け|協業/
    ])
  );
  score += add(
    breakdown,
    "coderRecruiting",
    20,
    hasSignal(input.scoreSignals.hasCoderRecruiting, text, [
      /コーダー|エンジニア|フロントエンド|HTML\/CSS|HTML・CSS|マークアップ/
    ])
  );
  score += add(
    breakdown,
    "wordpress",
    10,
    hasSignal(input.scoreSignals.handlesWordPress, text, [/WordPress|ワードプレス/i])
  );
  score += add(
    breakdown,
    "shopify",
    10,
    hasSignal(input.scoreSignals.handlesShopify, text, [/Shopify/i])
  );
  score += add(
    breakdown,
    "maintenance",
    5,
    hasSignal(input.scoreSignals.handlesMaintenance, text, [/保守|更新|運用/])
  );

  score += add(
    breakdown,
    "complementarity",
    calculateComplementarityScore(input, text),
    true
  );
  score += add(
    breakdown,
    "noOutsourcingPolicy",
    -30,
    hasSignal(input.scoreSignals.noOutsourcingPolicy, text, [/外注.{0,8}(利用しない|使わない|不可)/])
  );
  score += add(
    breakdown,
    "lowCollaborationFit",
    -15,
    input.scoreSignals.lowCollaborationFit === true
  );

  return score;
};

const calculateDirectClientBaseScore = (
  input: ScoreInput,
  text: string,
  breakdown: Record<string, number>
): number => {
  let score = 0;

  score += add(breakdown, "officialWebsite", 10, Boolean(input.officialSiteUrl));
  score += add(breakdown, "contactMethod", 10, Boolean(input.contactUrl || input.email));
  score += add(
    breakdown,
    "targetRegion",
    10,
    input.scoreSignals.isTargetArea !== false && Boolean(input.region)
  );
  score += add(
    breakdown,
    "mobileIssue",
    10,
    hasSignal(input.scoreSignals.hasMobileIssue, text, [/スマホ|モバイル|レスポンシブ/])
  );
  score += add(
    breakdown,
    "contactFlowIssue",
    10,
    hasSignal(input.scoreSignals.hasWeakContactFlow, text, [/問い合わせ導線|予約導線|導線.{0,8}(弱い|改善|整理)/])
  );
  score += add(
    breakdown,
    "weakCta",
    5,
    hasSignal(input.scoreSignals.hasWeakCta, text, [/CTA|ボタン|資料請求|無料相談/])
  );
  score += add(
    breakdown,
    "seoIssue",
    5,
    hasSignal(input.scoreSignals.hasSeoIssue, text, [/SEO|検索|地域キーワード|タイトル|メタ/])
  );
  score += add(
    breakdown,
    "staleSite",
    10,
    hasSignal(input.scoreSignals.hasStaleSite, text, [/更新停止|更新されていない|古い|長年運用/])
  );
  score += add(
    breakdown,
    "weakRecruitingPage",
    5,
    hasSignal(input.scoreSignals.hasWeakRecruitingPage, text, [/採用ページ|求人ページ|採用導線/])
  );
  score += add(
    breakdown,
    "unclearService",
    5,
    hasSignal(input.scoreSignals.hasUnclearService, text, [/サービス内容.{0,8}(不明|分かりにくい|整理)/])
  );
  score += add(
    breakdown,
    "oldDesign",
    10,
    hasSignal(input.scoreSignals.hasOldDesign, text, [/デザイン.{0,8}(古い|旧来)|構成.{0,8}(古い|旧来)/])
  );
  score += add(
    breakdown,
    "recentRenewalPenalty",
    directRenewalPenalty(input.estimatedRenewalPeriod),
    true
  );
  score += add(
    breakdown,
    "largeCompanyPenalty",
    -20,
    input.companySizeCategory === "大規模"
  );
  score += add(
    breakdown,
    "listedCompanyPenalty",
    -20,
    input.listingStatus === "上場"
  );

  return score;
};

export const calculateSalesScore = (input: ScoreInput): ScoreResult => {
  const text = buildText(input);
  const exclusionReason = getExclusionReason(input, text);
  const breakdown: Record<string, number> = {};

  if (exclusionReason) {
    return {
      baseScore: 0,
      aiAdjustment: 0,
      salesScore: 0,
      scoreBreakdown: {
        excluded: 0
      },
      status: "除外",
      exclusionReason,
      scoreError: ""
    };
  }

  const baseScore =
    input.leadType === "直クライアント"
      ? calculateDirectClientBaseScore(input, text, breakdown)
      : calculateAgencyBaseScore(input, text, breakdown);
  const aiAdjustment = clamp(Math.round(input.aiAdjustment || 0), -10, 10);

  if (aiAdjustment !== 0) {
    breakdown.aiAdjustment = aiAdjustment;
  }

  const salesScore = clamp(Math.round(baseScore + aiAdjustment), 0, 100);
  const status: Status =
    input.recommendedApproach === "見送り" || salesScore < 50 ? "見送り" : "未確認";

  return {
    baseScore,
    aiAdjustment,
    salesScore,
    scoreBreakdown: {
      ...breakdown,
      total: salesScore
    },
    status,
    exclusionReason: "",
    scoreError: ""
  };
};
