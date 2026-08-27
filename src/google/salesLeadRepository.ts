import { buildSalesLeadRow, SalesLeadInput, SHEETS } from "../domain/lead";
import { SheetsClient } from "./sheetsClient";

export type AppendLeadResult = {
  leadId: string;
  range?: string;
  rowNumber: number;
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

export const appendSalesLead = async (
  sheets: SheetsClient,
  lead: SalesLeadInput
): Promise<AppendLeadResult> => {
  const rowNumber = await getNextRowNumber(sheets, SHEETS.salesManagement);
  const row = buildSalesLeadRow(lead, rowNumber);
  const range = `'${SHEETS.salesManagement}'!A${rowNumber}:P${rowNumber}`;

  const response = await sheets.updateValues(range, [row]);

  return {
    leadId: lead.leadId,
    range: response.updatedRange ?? undefined,
    rowNumber
  };
};
