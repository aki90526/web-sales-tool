export const SHEETS = {
  salesManagement: "営業管理",
  analysisLog: "分析ログ",
  approachHistory: "アプローチ履歴"
} as const;

export const LEAD_TYPES = ["広告代理店", "Web制作会社", "直クライアント"] as const;
export const PROPOSAL_TYPES = [
  "協業提案",
  "外注先提案",
  "Webサイト改善提案",
  "LP制作提案",
  "保守運用提案"
] as const;
export const REVIEW_STATUSES = ["未確認", "確認中", "承認", "差し戻し", "除外"] as const;
export const SEND_PERMISSIONS = ["未判定", "送信OK", "送信NG"] as const;
export const SEND_STATUSES = ["未送信", "下書き", "送信済み", "返信あり", "送信不可"] as const;
export const REPLY_STATUSES = ["未返信", "返信あり", "商談化", "失注", "再営業禁止"] as const;
export const EXCLUDE_REASONS = ["", "対象外", "競合", "連絡不可", "配信停止", "再営業禁止", "重複"] as const;
export const LISTING_STATUSES = ["不明", "未上場", "上場", "公的機関", "個人事業"] as const;
export const COMPANY_SIZE_CATEGORIES = ["不明", "小規模", "中規模", "大規模"] as const;

export type LeadType = (typeof LEAD_TYPES)[number];
export type ProposalType = (typeof PROPOSAL_TYPES)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type SendPermission = (typeof SEND_PERMISSIONS)[number];
export type SendStatus = (typeof SEND_STATUSES)[number];
export type ReplyStatus = (typeof REPLY_STATUSES)[number];
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number];
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type CompanySizeCategory = (typeof COMPANY_SIZE_CATEGORIES)[number];

export type SalesLeadInput = {
  leadId: string;
  companyName: string;
  leadType: LeadType;
  industry: string;
  region: string;
  officialSiteUrl: string;
  source: string;
  contactUrl: string;
  email: string;
  siteAnalysisSummary: string;
  improvementPoints: string;
  salesScore: number;
  proposalType: ProposalType;
  salesMessageDraft: string;
  reviewStatus: ReviewStatus;
  sendPermission: SendPermission;
  sendStatus: SendStatus;
  replyStatus: ReplyStatus;
  excludeFlag: boolean;
  excludeReason: ExcludeReason;
  updatedAt: string;
  memo: string;
  capital: string;
  employeeCount: string;
  annualRevenue: string;
  listingStatus: ListingStatus;
  companySizeCategory: CompanySizeCategory;
  companySizeMemo: string;
};

export const buildSalesLeadRow = (lead: SalesLeadInput, rowNumber: number): unknown[] => {
  const approachLeadColumn = "'アプローチ履歴'!$A:$A";
  const approachSendStatusColumn = "'アプローチ履歴'!$J:$J";
  const approachSentAtColumn = "'アプローチ履歴'!$L:$L";

  return [
    lead.leadId,
    lead.companyName,
    lead.leadType,
    lead.industry,
    lead.region,
    lead.officialSiteUrl,
    lead.source,
    lead.contactUrl,
    lead.email,
    lead.siteAnalysisSummary,
    lead.improvementPoints,
    lead.salesScore,
    lead.proposalType,
    lead.salesMessageDraft,
    lead.reviewStatus,
    lead.sendPermission,
    lead.sendStatus,
    lead.replyStatus,
    lead.excludeFlag,
    lead.excludeReason,
    lead.updatedAt,
    lead.memo,
    `=IF(A${rowNumber}="","",COUNTIFS(${approachLeadColumn},A${rowNumber},${approachSendStatusColumn},"送信済み"))`,
    `=IF(A${rowNumber}="","",IFERROR(MAX(FILTER(${approachSentAtColumn},${approachLeadColumn}=A${rowNumber},${approachSendStatusColumn}="送信済み")),""))`,
    `=IF(OR(A${rowNumber}="",X${rowNumber}=""),"",X${rowNumber}+'設定'!$B$13)`,
    `=IF(A${rowNumber}="","",IF(S${rowNumber}=TRUE,"除外",IF(W${rowNumber}=0,"未送信",IF(TODAY()>=Y${rowNumber},"再送信可","待機"))))`,
    lead.capital,
    lead.employeeCount,
    lead.annualRevenue,
    lead.listingStatus,
    lead.companySizeCategory,
    lead.companySizeMemo
  ];
};
