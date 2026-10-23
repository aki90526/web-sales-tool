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

// 営業先を探すAIへの指示のうち、利用者ごとに変えられる部分（設定画面・設定シートで編集する）
export type CollectionGuidance = {
  // 何のための営業候補か（誰が、誰に、何を提案するか）
  purpose: string;
  // 制作会社・広告代理店で、どこを重視して探すか
  partnerFocus: string;
  // 直クライアントで、どこを重視して探すか
  directFocus: string;
};

export const DEFAULT_COLLECTION_GUIDANCE: CollectionGuidance = {
  purpose:
    "aaWebCreate（春日部市のフリーランスWeb制作者）が、制作会社・広告代理店には外部パートナー提案、直クライアントにはWebサイト改善提案を行うための営業候補を作る。",
  partnerFocus:
    "外部パートナー募集、業務委託募集、コーダー・エンジニア募集、WordPress、Shopify、保守更新、協業余地を重視してください。企業規模が大きいだけで低評価にしないでください。",
  directFocus:
    "サイト改善余地、問い合わせ導線、CTA、SEO、更新停止感、古いデザイン、採用改善、LP化余地を重視してください。上場企業・大規模企業・直近リニューアル済みは優先度を下げる判定材料を入れてください。"
};

export type CollectLeadCandidateOptions = {
  guidance?: CollectionGuidance;
  area: string;
  autoRejectLowScore?: boolean;
  excludeArea?: string;
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

const stripMarkdownLink = (value: string): string => {
  const markdownLink = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/i.exec(value.trim());

  return markdownLink ? markdownLink[2] : value;
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
    throw new Error(
      `OpenAI response was not a complete JSON array. Try a smaller --limit if this repeats. Preview: ${withoutFence.slice(0, 300)}`
    );
  }

  const jsonText = withoutFence.slice(start, end + 1);

  try {
    return JSON.parse(jsonText);
  } catch (error: unknown) {
    try {
      // AIが末尾カンマ付きのJSON（`,}` や `,]`）を返すことがあるため、取り除いて再解析する
      return JSON.parse(jsonText.replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      // 下で元のエラーを投げる
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OpenAI response JSON could not be parsed (${message}). Try a smaller --limit if this repeats. Preview: ${withoutFence.slice(0, 300)}`
    );
  }
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
  const url = stripMarkdownLink(text(value, 500));

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
    return "フォーム";
  }

  return "未定";
};

export const normalizeLeadCandidate = (
  value: unknown,
  scoreOptions: { autoRejectLowScore?: boolean } = {}
): LeadCandidate | null => {
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
  const rawEmail = text(value.email, 200);
  // Cloudflareのメールアドレス難読化保護がかかったサイトをJSなしで読むと、実際のアドレスの
  // 代わりにこの固定文字列がそのまま表示されることがある。実在しないダミーなので除外する。
  const email = rawEmail.toLowerCase() === "[email protected]" ? "" : rawEmail;
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
    autoRejectLowScore: scoreOptions.autoRejectLowScore,
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

const splitAreaTerms = (value: string): string[] => {
  return value
    .split(/[\s,、，・/／]+/)
    .map((term) => term.trim())
    .filter(Boolean);
};

// 所在地(region)が、検索エリアに当たるかを判定する。「東京都 港区」のように、都道府県と市区町村を並べた指定では、
// 都道府県（東京都）だけで全件に当たってしまわないよう、市区町村のほうだけで判定する。「東京都23区」は「東京都」として扱う
export const isInSearchArea = (region: string, area: string | undefined): boolean => {
  if (!area || !region) {
    return false;
  }

  const terms = splitAreaTerms(area.replace(/23区/g, ""));
  const specific = terms.filter((term) => !/[都道府県]$/.test(term));
  const targets = specific.length > 0 ? specific : terms;
  const prefectureOf = (value: string): string => /^(北海道|.{2,3}[都府県])/.exec(value)?.[1] ?? "";

  return targets.some((term) => {
    const core = /[都府県]$/.test(term) && term.length > 2 ? term.slice(0, -1) : term;

    if (region.includes(term) || region.includes(core)) {
      return true;
    }

    // 登録済みの所在地に都道府県が無い（「渋谷区」だけなど）場合も、「東京都渋谷区」の検索に当てる。
    // 別の都道府県の同名の区（大阪府の港区など）には当てない
    const prefecture = prefectureOf(term);
    const tail = prefecture ? term.slice(prefecture.length) : "";

    return tail.length >= 2 && region.includes(tail) && (prefectureOf(region) === "" || prefectureOf(region) === prefecture);
  });
};

// 所在地(region)が除外エリアに当たるかを判定する。「東京都」は「東京」でも一致させる。
export const isInExcludedArea = (region: string, excludeArea: string | undefined): boolean => {
  if (!excludeArea) {
    return false;
  }

  return splitAreaTerms(excludeArea).some((term) => {
    const core = /[都府県]$/.test(term) && term.length > 2 ? term.slice(0, -1) : term;

    return region.includes(term) || region.includes(core);
  });
};

// 検索するエリアに登録済みの会社・URLを、除外リストとして渡す上限（エリアの分だけを渡すので、80より多くしても、全体より少ない）
const EXCLUDE_LIST_LIMIT = 200;

const buildPrompt = (options: CollectLeadCandidateOptions): string => {
  const guidance = options.guidance ?? DEFAULT_COLLECTION_GUIDANCE;
  const excludedCompanies = options.existingCompanies.slice(-EXCLUDE_LIST_LIMIT).join(" / ") || "なし";
  const excludedUrls = options.existingSiteUrls.slice(-EXCLUDE_LIST_LIMIT).join(" / ") || "なし";

  return [
    "あなたは日本のWeb制作営業リスト作成アシスタントです。必ずWeb検索を使い、実在する企業だけを抽出してください。",
    `対象地域: ${options.area}`,
    ...(options.excludeArea
      ? [
          `除外地域: ${options.excludeArea}`,
          "除外地域ルール: 除外地域に所在する企業（本社・所在地が除外地域にある企業）は、候補に絶対に含めないでください。対象地域の中でも、除外地域に当たる部分は探さないでください。"
        ]
      : []),
    `対象種別: ${options.targetTypes.join(", ")}`,
    `候補件数: 最大${options.limit}件`,
    `目的: ${guidance.purpose}`,
    "重要: 営業スコアの最終計算はシステム側で行います。あなたは固定スコア用の判定材料、推奨アプローチ、AI補正だけを返してください。",
    "優先条件: 公式サイトURLが確認できる、問い合わせフォームまたはメールがある、Web制作/WordPress/フロントエンド/Shopify/保守運用の提案余地がある。",
    "会社名ルール: companyName は公式サイトの会社概要、運営会社、フッター、プライバシーポリシー等で確認できる正式表記をそのまま入れてください。株式会社、有限会社、合同会社などの法人格を推測で付け替えたり補完したりしないでください。",
    "会社名ルール: 正式な法人格が確認できない場合は、屋号・サービス名など公式サイトに表示されている名称をそのまま入れ、法人格は追加しないでください。",
    "会社名ルール: 「株式会社monomode（モノモード）」のような読み仮名・英字表記の括弧書きは付けず、「株式会社monomode」のように会社名だけを入れてください。",
    "会社名ルール: 法人格は1つだけにしてください。「株式会社ライズエージェンシー 株式会社」のようにページタイトル等の表記をそのまま写して法人格が二重にならないよう注意してください。",
    `制作会社・広告代理店: ${guidance.partnerFocus}`,
    `直クライアント: ${guidance.directFocus}`,
    "除外条件: 営業目的の問い合わせ禁止、広告宣伝メール禁止、公式サイトではない、既存候補と重複、同業フリーランス個人のみのサイト、明確な対象外業種。",
    `既存候補の企業名: ${excludedCompanies}`,
    `既存候補のURL: ${excludedUrls}`,
    "返答はJSON配列のみ。Markdown、説明文、引用マーカーは不要。",
    "各要素のキーは必ず次の通りにしてください:",
    "companyName, leadType, industry, region, officialSiteUrl, contactUrl, email, siteAnalysisSummary, improvementPoints, salesAngle, recommendedApproach, memo, pageType, mobileResponsive, seoBasics, cta, contactFlow, updateStatus, ssl, cms, estimatedRenewalPeriod, renewalConfidence, renewalEvidence, aiAnalysis, aiAdjustment, aiAdjustmentReason, exclusionReason, scoreSignals, capital, employeeCount, annualRevenue, listingStatus, companySizeCategory, companySizeMemo",
    `leadType は次のいずれかのみ: ${LEAD_TYPES.join(", ")}`,
    `recommendedApproach は次のいずれかのみ: ${RECOMMENDED_APPROACHES.join(", ")}`,
    `estimatedRenewalPeriod は次のいずれかのみ: ${RENEWAL_PERIODS.join(", ")}`,
    `renewalConfidence は次のいずれかのみ: ${RENEWAL_CONFIDENCES.join(", ")}`,
    `listingStatus は次のいずれかのみ: ${LISTING_STATUSES.join(", ")}`,
    `companySizeCategory は次のいずれかのみ: ${COMPANY_SIZE_CATEGORIES.join(", ")}`,
    "aiAdjustment は -10〜10 の整数。固定ロジックでは判断しづらい定性的な補正だけを入れてください。不明なら0。",
    "scoreSignals はJSONオブジェクトで、次のboolean/numberを可能な範囲で返してください:",
    "isOfficialSite, hasContactMethod, isTargetArea, isWebProductionBusiness, hasPartnerRecruiting, hasSubcontractorRecruiting, hasCoderRecruiting, handlesWordPress, handlesShopify, handlesMaintenance, complementarityScore, noOutsourcingPolicy, lowCollaborationFit, hasMobileIssue, hasWeakContactFlow, hasWeakCta, hasSeoIssue, hasStaleSite, hasWeakRecruitingPage, hasUnclearService, hasOldDesign, forbidsSalesContact, forbidsAdsMail, pastOptOut, reapproachForbidden, notOfficialSite, excludedIndustry",
    "contactUrl は実際に入力欄がある問い合わせフォームURLを入れてください。/contact/ のような入口ページに複数の窓口リンクがある場合は、対象に最も合う詳細フォームURLを選んでください。",
    "contactUrl は、制作会社・広告代理店では制作パートナー、協業、提携、業務委託、営業向け窓口を優先してください。直クライアントでは一般問い合わせ、相談フォームを優先してください。不明なら空文字。",
    "contactUrl 除外: 「見積もり依頼」専用フォーム（リニューアル内容やページ数などその会社自身のサービスの見積もりだけを受け付けるフォーム）は、協業・パートナー提案や一般的な問い合わせの送信先として不適切なため選ばないでください。サイト内に見積もり専用フォーム以外の問い合わせ窓口（一般お問い合わせフォームやメールアドレス）がない場合は、contactUrl は空文字にしてください。",
    "contactUrl 除外: 問い合わせフォームに「お問合せ内容」のようなカテゴリ選択欄があり、その選択肢が全て「その会社が提供するサービスの依頼・相談」（例: サイト制作のご相談、システム開発のご相談、資料請求 等）で占められていて、協業・パートナー・業務委託・その他に類する選択肢が一つもない場合も、送信先として不適切なため選ばないでください。この場合も、他に適切な問い合わせ窓口（メールアドレス等）がなければ contactUrl は空文字にしてください。",
    "contactUrl 除外: 問い合わせフォームに「予算」「希望納期」「ご予算」などの項目が必須入力として含まれる場合は、制作依頼専用のフォームであり協業・パートナー提案には不適切なため選ばないでください。この場合も、他に適切な問い合わせ窓口（メールアドレス等）がなければ contactUrl は空文字にしてください。",
    "email は不明なら空文字。Cloudflareのメールアドレス難読化保護がかかっているサイトでは、実際のメールアドレスの代わりに「[email protected]」という文字列がそのまま表示されることがあります。この文字列は実在しないダミーなので、email には絶対に入れないでください（不明として空文字にしてください）。",
    "email 探索ルール: 営業連絡はなるべくメールで行いたいため、メールアドレスを可能な限り見つけてください。問い合わせフォームしか見つからない場合は、フォームのみの候補として扱って構いません（email は空文字）。",
    "email 探索ルール: まず公式サイト（問い合わせページ、会社概要、フッター、プライバシーポリシー、採用ページ）を確認し、そこに無ければ、企業情報サイト、求人サイト（Wantedly、doda、マイナビ等）、Googleビジネスプロフィール、商工会議所などの会員名簿といった第三者サイトも探してください。",
    "email 探索ルール: 第三者サイトで見つけたアドレスは、その会社の公式ドメイン（公式サイトと同じドメイン）のものか、会社名・所在地が一致している場合のみ採用してください。別会社のアドレス、個人名のアドレス、フリーメール、古い情報と思われるもの、問い合わせ・代表窓口と思われないものは採用せず空文字にしてください。",
    "email 探索ルール: 第三者サイトのアドレスを採用した場合は、memo に「メール出典: 参照したサイトのURL」を必ず書いてください。公式サイトで見つけた場合は書かなくて構いません。",
    "資本金、従業員数、売上高は公式サイトや信頼できる会社情報で確認できた場合のみ入れ、不明なら空文字。",
    "salesAngle はカスタムメールテンプレートの差し込み変数として使うため、営業の切り口を具体的かつ簡潔に1文で返してください。営業メール本文全体は作成しないでください。"
  ].join("\n");
};

const maxOutputTokensForLimit = (limit: number): number => {
  return Math.min(12000, Math.max(4000, 2500 + limit * 1000));
};

const COLLECTION_CHUNK_SIZE = 5;

const collectLeadCandidateChunk = async (
  openAI: OpenAIClient,
  options: CollectLeadCandidateOptions
): Promise<LeadCandidateCollectionResult> => {
  const requestParsed = async (): Promise<{ response: Awaited<ReturnType<OpenAIClient["createWebSearchResponse"]>>; parsed: unknown }> => {
    const response = await openAI.createWebSearchResponse(
      buildPrompt(options),
      maxOutputTokensForLimit(options.limit)
    );

    return { response, parsed: extractJsonArray(extractOutputText(response)) };
  };
  let result: Awaited<ReturnType<typeof requestParsed>>;

  try {
    result = await requestParsed();
  } catch (error: unknown) {
    if (!(error instanceof Error) || !error.message.startsWith("OpenAI response JSON could not be parsed")) {
      throw error;
    }

    console.log("OpenAI response JSON could not be parsed. Retrying once...");
    result = await requestParsed();
  }

  const { response, parsed } = result;

  if (!Array.isArray(parsed)) {
    throw new Error("OpenAI response JSON was not an array");
  }

  const candidates = parsed
    .map((entry) => normalizeLeadCandidate(entry, { autoRejectLowScore: options.autoRejectLowScore }))
    .filter((candidate): candidate is LeadCandidate => candidate !== null)
    .filter((candidate) => {
      const excluded = isInExcludedArea(candidate.region, options.excludeArea);

      if (excluded) {
        console.log(`Excluded by area (${options.excludeArea}): ${candidate.companyName} / ${candidate.region}`);
      }

      return !excluded;
    })
    .slice(0, options.limit);

  return {
    candidates,
    searchTrace: extractWebSearchTrace(response)
  };
};

export const collectLeadCandidateCollection = async (
  openAI: OpenAIClient,
  options: CollectLeadCandidateOptions
): Promise<LeadCandidateCollectionResult> => {
  if (options.limit <= COLLECTION_CHUNK_SIZE) {
    return collectLeadCandidateChunk(openAI, options);
  }

  const candidates: LeadCandidate[] = [];
  const queries: string[] = [];
  const sourceUrls: string[] = [];

  while (candidates.length < options.limit) {
    const remaining = options.limit - candidates.length;
    const chunkLimit = Math.min(COLLECTION_CHUNK_SIZE, remaining);
    console.log(`Collecting chunk: ${candidates.length + 1}-${candidates.length + chunkLimit} of ${options.limit}`);
    const chunk = await collectLeadCandidateChunk(openAI, {
      ...options,
      limit: chunkLimit,
      existingCompanies: [
        ...options.existingCompanies,
        ...candidates.map((candidate) => candidate.companyName)
      ],
      existingSiteUrls: [
        ...options.existingSiteUrls,
        ...candidates.map((candidate) => candidate.officialSiteUrl)
      ]
    });

    queries.push(...chunk.searchTrace.queries);
    sourceUrls.push(...chunk.searchTrace.sourceUrls);

    const beforeCount = candidates.length;

    chunk.candidates.forEach((candidate) => {
      const duplicate = candidates.some((existing) => {
        return (
          existing.companyName === candidate.companyName ||
          existing.officialSiteUrl === candidate.officialSiteUrl
        );
      });

      if (!duplicate) {
        candidates.push(candidate);
      }
    });

    if (chunk.candidates.length === 0 || candidates.length === beforeCount) {
      break;
    }
  }

  return {
    candidates: candidates.slice(0, options.limit),
    searchTrace: {
      queries: Array.from(new Set(queries)),
      sourceUrls: Array.from(new Set(sourceUrls))
    }
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
    status: candidate.status,
    memo: memoParts.join("\n")
  };
};
