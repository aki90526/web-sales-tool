import { SHEETS } from "../domain/lead";
import { SheetsClient } from "./sheetsClient";

export type AnalysisDataInput = {
  leadId: string;
  targetUrl: string;
  pageType: string;
  analyzedAt: string;
  mobileResponsive: string;
  seoBasics: string;
  cta: string;
  contactFlow: string;
  updateStatus: string;
  ssl: string;
  cms: string;
  improvementPoints: string;
  recommendedApproach: string;
  estimatedRenewalPeriod: string;
  renewalConfidence: string;
  renewalEvidence: string;
  aiAnalysis: string;
  aiAdjustment: number;
  aiAdjustmentReason: string;
  baseScore: number;
  salesScore: number;
  scoreBreakdown: Record<string, number>;
  exclusionReason: string;
  searchCondition: string;
  searchQueries: string[];
  sourceUrls: string[];
  acquiredAt: string;
  capital: string;
  employeeCount: string;
  annualRevenue: string;
  listingStatus: string;
  companySizeCategory: string;
  companySizeMemo: string;
};

const getNextRowNumber = async (
  sheets: SheetsClient,
  sheetName: string
): Promise<number> => {
  const values = await sheets.getValues(`'${sheetName}'!A:A`);

  for (let index = 1; index < values.length; index += 1) {
    const leadId = values[index]?.[0];

    if (leadId === undefined || leadId === null || String(leadId).trim() === "") {
      return index + 1;
    }
  }

  return values.length + 1;
};

const joinLimited = (values: string[], maxLength: number): string => {
  const joined = values
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");

  return joined.length > maxLength ? `${joined.slice(0, maxLength - 3)}...` : joined;
};

export const readAnalysisRecommendedApproaches = async (
  sheets: SheetsClient
): Promise<Map<string, string>> => {
  const rows = await sheets.getValues(`'${SHEETS.analysisData}'!A1:AG1000`);
  const headers = (rows[0] ?? []).map((value) => String(value ?? "").trim());
  const leadIdColumn = headers.findIndex((header) => header === "リードID");
  const recommendedApproachColumn = headers.findIndex((header) => header === "推奨アプローチ");
  const approaches = new Map<string, string>();

  if (leadIdColumn === -1 || recommendedApproachColumn === -1) {
    return approaches;
  }

  rows.slice(1).forEach((row) => {
    const leadId = String(row[leadIdColumn] ?? "").trim();
    const recommendedApproach = String(row[recommendedApproachColumn] ?? "").trim();

    if (leadId && recommendedApproach) {
      approaches.set(leadId, recommendedApproach);
    }
  });

  return approaches;
};

export const appendAnalysisData = async (
  sheets: SheetsClient,
  data: AnalysisDataInput
): Promise<{ range?: string; rowNumber: number }> => {
  const rowNumber = await getNextRowNumber(sheets, SHEETS.analysisData);
  const range = `'${SHEETS.analysisData}'!A${rowNumber}:AG${rowNumber}`;
  const response = await sheets.updateValues(range, [
    [
      data.leadId,
      data.targetUrl,
      data.pageType,
      data.analyzedAt,
      data.mobileResponsive,
      data.seoBasics,
      data.cta,
      data.contactFlow,
      data.updateStatus,
      data.ssl,
      data.cms,
      data.improvementPoints,
      data.estimatedRenewalPeriod,
      data.renewalConfidence,
      data.renewalEvidence,
      data.aiAnalysis,
      data.aiAdjustment,
      data.aiAdjustmentReason,
      data.baseScore,
      data.salesScore,
      JSON.stringify(data.scoreBreakdown),
      data.exclusionReason,
      data.searchCondition,
      joinLimited(data.searchQueries, 4000),
      joinLimited(data.sourceUrls, 12000),
      data.acquiredAt,
      data.capital,
      data.employeeCount,
      data.annualRevenue,
      data.listingStatus,
      data.companySizeCategory,
      data.companySizeMemo,
      data.recommendedApproach
    ]
  ]);

  return {
    range: response.updatedRange ?? undefined,
    rowNumber
  };
};
