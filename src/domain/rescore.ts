import { SHEETS } from "./lead";
import { calculateSalesScore } from "./scoring";
import { SalesManagementLead } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";

// 営業スコアの再計算（概算）。
// スコアの計算には、AIが返す「判定のメモ」（scoreSignals）を使うが、シートには保存していない。
// そのため、保存済みの分析文・業種・規模などから、言葉で判定するしくみ（scoring.ts の文章による判定）で、概算を出す。
// 除外で 0 になったリードを戻すときの目安として使う。AIの細かい判定は反映されないので、ずれることがある。

export type RescorePreview = {
  leadId: string;
  currentScore: number;
  approximateScore: number;
  breakdown: Array<{ key: string; value: number }>;
  // 概算の根拠にした情報が足りないとき（分析データが無いなど）の注意
  warning: string;
};

export const previewApproximateScore = async (sheets: SheetsClient, lead: SalesManagementLead): Promise<RescorePreview> => {
  const rows = await sheets.getValues(`'${SHEETS.analysisData}'!A1:AZ1000`);
  const headers = (rows[0] ?? []).map((value) => String(value ?? "").trim());
  const row = rows.find((entry) => String(entry[0] ?? "").trim() === lead.leadId);
  const column = (name: string): string => (row ? String(row[headers.indexOf(name)] ?? "").trim() : "");

  const result = calculateSalesScore({
    autoRejectLowScore: false,
    leadType: lead.leadType as never,
    industry: lead.industry,
    region: lead.region,
    officialSiteUrl: lead.officialSiteUrl,
    contactUrl: lead.contactFormUrl,
    email: lead.emailAddress,
    siteAnalysisSummary: column("AI分析結果"),
    improvementPoints: column("改善ポイント"),
    salesAngle: column("営業の切り口"),
    recommendedApproach: (column("推奨アプローチ") || "制作パートナー") as never,
    estimatedRenewalPeriod: (column("推定リニューアル時期") || "不明") as never,
    aiAnalysis: column("AI分析結果"),
    aiAdjustment: Number(column("AI補正値")) || 0,
    aiAdjustmentReason: column("AI補正理由"),
    listingStatus: (column("上場区分") || "不明") as never,
    companySizeCategory: (column("規模判定") || "不明") as never,
    companySizeMemo: column("規模メモ"),
    exclusionReason: "",
    scoreSignals: {}
  } as never);

  return {
    leadId: lead.leadId,
    currentScore: lead.salesScore,
    approximateScore: result.salesScore,
    breakdown: Object.entries(result.scoreBreakdown)
      .filter(([key]) => key !== "total")
      .map(([key, value]) => ({ key, value })),
    warning: row ? "" : "分析データが見つからないため、概算の精度が低くなります"
  };
};
