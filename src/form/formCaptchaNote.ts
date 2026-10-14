import { fieldRangeForRow, readSalesManagementTable } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";

// 「[CAPTCHA]」を含むメモのリードは、次回以降の自動入力の対象から外れる
export const appendCaptchaNote = async (sheets: SheetsClient, leadId: string, label: string): Promise<void> => {
  const table = await readSalesManagementTable(sheets);
  const lead = table.leads.find((entry) => entry.leadId === leadId);

  if (!lead) {
    return;
  }

  const note = `[CAPTCHA] ${label}`;

  if (lead.memo.includes(note)) {
    return;
  }

  const nextMemo = lead.memo ? `${lead.memo}\n${note}` : note;
  await sheets.updateValues(fieldRangeForRow(table.columns, "memo", lead.rowNumber), [[nextMemo]]);
};
