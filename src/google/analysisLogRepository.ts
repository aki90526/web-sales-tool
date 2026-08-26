import { SHEETS } from "../domain/lead";
import { SheetsClient } from "./sheetsClient";

export type AnalysisLogInput = {
  leadId: string;
  companyName: string;
  officialSiteUrl: string;
  acquiredAt: string;
  targetPageUrl: string;
  pageType: string;
  mainImprovementPoint: string;
  analysisMemo: string;
  searchCondition: string;
  searchQueries: string[];
  sourceUrls: string[];
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

export const appendAnalysisLog = async (
  sheets: SheetsClient,
  log: AnalysisLogInput
): Promise<{ range?: string; rowNumber: number }> => {
  const rowNumber = await getNextRowNumber(sheets, SHEETS.analysisLog);
  const range = `'${SHEETS.analysisLog}'!A${rowNumber}:R${rowNumber}`;
  const response = await sheets.updateValues(range, [
    [
      log.leadId,
      log.companyName,
      log.officialSiteUrl,
      log.acquiredAt,
      log.targetPageUrl,
      log.pageType,
      "",
      "",
      "",
      "",
      "",
      "",
      log.mainImprovementPoint,
      log.analysisMemo,
      log.searchCondition,
      joinLimited(log.searchQueries, 4000),
      joinLimited(log.sourceUrls, 12000),
      log.acquiredAt
    ]
  ]);

  return {
    range: response.updatedRange ?? undefined,
    rowNumber
  };
};
