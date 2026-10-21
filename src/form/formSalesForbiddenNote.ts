import { fieldRangeForRow, readSalesManagementTable, statusRangeForRow } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";

// 問い合わせページに営業お断りの記載があったリードを「除外」にして、根拠をメモに残す
export const excludeLeadForSalesForbidden = async (
  sheets: SheetsClient,
  leadId: string,
  excerpt: string,
  pageUrl: string
): Promise<void> => {
  const table = await readSalesManagementTable(sheets);
  const lead = table.leads.find((entry) => entry.leadId === leadId);

  if (!lead) {
    return;
  }

  const note = `営業お断りの記載を検出（フォーム入力前の確認）: 「${excerpt}」 (${pageUrl})`;

  if (lead.status !== "除外") {
    await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [["除外"]]);
  }

  if (!lead.memo.includes(note)) {
    await sheets.updateValues(fieldRangeForRow(table.columns, "memo", lead.rowNumber), [[lead.memo ? `${lead.memo}\n${note}` : note]]);
  }
};
