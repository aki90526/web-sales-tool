export const SHEETS = {
  salesManagement: "営業管理",
  analysisData: "分析データ",
  approachHistory: "アプローチ履歴",
  messageTemplates: "メッセージテンプレート",
  settings: "設定"
} as const;

export const SETTINGS_CELLS = {
  resendIntervalDays: "'設定'!$B$2"
} as const;

export const LEAD_TYPES = ["広告代理店", "Web制作会社", "直クライアント"] as const;

export const CONTACT_METHODS = ["問い合わせフォーム", "メール", "電話", "未定"] as const;

export const RECOMMENDED_APPROACHES = [
  "全面リニューアル",
  "部分改善",
  "採用改善",
  "SEO改善",
  "LP制作",
  "保守・更新",
  "WordPress改修",
  "制作パートナー",
  "外注先提案",
  "協業提案",
  "見送り"
] as const;

export const STATUSES = [
  "未確認",
  "確認済み",
  "送信待ち",
  "送信済み",
  "返信あり",
  "商談中",
  "見送り",
  "除外"
] as const;

export const LISTING_STATUSES = ["不明", "未上場", "上場", "公的機関", "個人事業"] as const;
export const COMPANY_SIZE_CATEGORIES = ["不明", "小規模", "中規模", "大規模"] as const;

export const PROPOSAL_TYPES = [
  "協業提案",
  "外注先提案",
  "Webサイト改善提案",
  "LP制作提案",
  "保守運用提案"
] as const;

export type LeadType = (typeof LEAD_TYPES)[number];
export type ContactMethod = (typeof CONTACT_METHODS)[number];
export type RecommendedApproach = (typeof RECOMMENDED_APPROACHES)[number];
export type Status = (typeof STATUSES)[number];
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type CompanySizeCategory = (typeof COMPANY_SIZE_CATEGORIES)[number];
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export type SalesLeadInput = {
  leadId: string;
  companyName: string;
  leadType: LeadType;
  industry: string;
  region: string;
  officialSiteUrl: string;
  contactMethod: ContactMethod;
  contactFormUrl: string;
  emailAddress: string;
  salesScore: number;
  salesAngle: string;
  salesMessageDraft: string;
  status: Status;
  memo: string;
};
