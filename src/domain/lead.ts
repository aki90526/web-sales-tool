export const SHEETS = {
  salesManagement: "営業管理",
  analysisData: "分析データ",
  approachHistory: "アプローチ履歴",
  messageTemplates: "メッセージテンプレート",
  settings: "設定",
  exclusionList: "除外リスト"
} as const;

export const SETTINGS_CELLS = {
  resendIntervalDays: "'設定'!$B$2"
} as const;

// 設定シートの項目名（A列）。初回の再送間隔は従来どおり B2 の「再送間隔日数」を使う。
export const RESEND_SETTING_KEYS = {
  firstIntervalDays: "再送間隔日数",
  laterIntervalDays: "再送間隔日数（2回目以降）",
  recheckIntervalDays: "見送り再確認間隔日数"
} as const;

export const DEFAULT_RESEND_SETTINGS = {
  firstIntervalDays: 90,
  laterIntervalDays: 180,
  recheckIntervalDays: 30
} as const;

// 営業管理の「連絡回数」。アプローチ履歴の「送信済み」（不達を除く）の件数
export const buildContactCountFormula = (leadIdCell: string): string => {
  return `=IF(${leadIdCell}="","",COUNTIFS('アプローチ履歴'!$A:$A,${leadIdCell},'アプローチ履歴'!$H:$H,"送信済み",'アプローチ履歴'!$I:$I,"<>不達"))`;
};

// 営業管理の「次回対応日」。送信済みが1回なら初回の間隔、2回目以降なら「2回目以降」の間隔を足す。
export const buildNextActionDateFormula = (leadIdCell: string, lastApproachDateCell: string): string => {
  const sentCount = `COUNTIFS('アプローチ履歴'!$A:$A,${leadIdCell},'アプローチ履歴'!$H:$H,"送信済み")`;
  const laterInterval = `IFERROR(VLOOKUP("${RESEND_SETTING_KEYS.laterIntervalDays}",'設定'!$A:$B,2,FALSE),${DEFAULT_RESEND_SETTINGS.laterIntervalDays})`;

  return `=IF(OR(${leadIdCell}="",${lastApproachDateCell}=""),"",${lastApproachDateCell}+IF(${sentCount}<=1,${SETTINGS_CELLS.resendIntervalDays},${laterInterval}))`;
};

export const LEAD_TYPES = ["広告代理店", "Web制作会社", "直クライアント"] as const;

export const CONTACT_METHODS = ["フォーム", "メール", "電話", "未定"] as const;

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
  "面談済み",
  "商談中",
  "保留",
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
  status: Status;
  memo: string;
};
