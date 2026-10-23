import { buildContactCountFormula, buildNextActionDateFormula, SalesLeadInput, SHEETS } from "../domain/lead";
import {
  columnLetter,
  readSalesManagementTable,
  SalesManagementColumnMap,
  SalesManagementTable
} from "./salesManagementRepository";
import { escapeFormulaText, SheetsClient } from "./sheetsClient";

export type AppendLeadResult = {
  leadId: string;
  range?: string;
  rowNumber: number;
};

const getNextRowNumber = (table: SalesManagementTable): number => {
  if (table.leads.length === 0) {
    return 2;
  }

  return Math.max(...table.leads.map((lead) => lead.rowNumber)) + 1;
};

const setCell = (
  row: unknown[],
  columns: SalesManagementColumnMap,
  column: keyof SalesManagementColumnMap,
  value: unknown
): void => {
  row[columns[column]] = value;
};

const buildHeaderMappedSalesLeadRow = (
  lead: SalesLeadInput,
  rowNumber: number,
  columns: SalesManagementColumnMap,
  width: number
): unknown[] => {
  const row: unknown[] = Array.from({ length: width }, () => "");
  const approachLeadColumn = "'アプローチ履歴'!$A:$A";
  const approachSentAtColumn = "'アプローチ履歴'!$B:$B";
  const approachSendStatusColumn = "'アプローチ履歴'!$H:$H";
  const leadIdCell = `${columnLetter(columns.leadId)}${rowNumber}`;
  const lastApproachDateCell = `${columnLetter(columns.lastApproachDate)}${rowNumber}`;

  setCell(row, columns, "leadId", escapeFormulaText(lead.leadId));
  setCell(row, columns, "companyName", escapeFormulaText(lead.companyName));
  setCell(row, columns, "leadType", escapeFormulaText(lead.leadType));
  setCell(row, columns, "industry", escapeFormulaText(lead.industry));
  setCell(row, columns, "region", escapeFormulaText(lead.region));
  setCell(row, columns, "officialSiteUrl", escapeFormulaText(lead.officialSiteUrl));
  setCell(row, columns, "contactMethod", escapeFormulaText(lead.contactMethod));
  setCell(row, columns, "contactFormUrl", escapeFormulaText(lead.contactFormUrl));
  setCell(row, columns, "emailAddress", escapeFormulaText(lead.emailAddress));
  setCell(row, columns, "salesScore", lead.salesScore);
  setCell(row, columns, "status", escapeFormulaText(lead.status));
  setCell(
    row,
    columns,
    "lastApproachDate",
    `=IF(${leadIdCell}="","",IFERROR(MAX(FILTER(${approachSentAtColumn},${approachLeadColumn}=${leadIdCell},${approachSendStatusColumn}="送信済み")),""))`
  );
  setCell(
    row,
    columns,
    "nextActionDate",
    buildNextActionDateFormula(leadIdCell, lastApproachDateCell)
  );
  setCell(row, columns, "memo", escapeFormulaText(lead.memo));

  if (columns.contactCount >= 0) {
    setCell(row, columns, "contactCount", buildContactCountFormula(leadIdCell));
  }

  return row;
};

export const appendSalesLead = async (
  sheets: SheetsClient,
  lead: SalesLeadInput
): Promise<AppendLeadResult> => {
  const table = await readSalesManagementTable(sheets);
  const rowNumber = getNextRowNumber(table);
  const width = table.headers.length;
  const row = buildHeaderMappedSalesLeadRow(lead, rowNumber, table.columns, width);
  const lastColumn = columnLetter(width - 1);
  const range = `'${SHEETS.salesManagement}'!A${rowNumber}:${lastColumn}${rowNumber}`;

  const response = await sheets.updateValues(range, [row], { allowFormulas: true });

  return {
    leadId: lead.leadId,
    range: response.updatedRange ?? undefined,
    rowNumber
  };
};
