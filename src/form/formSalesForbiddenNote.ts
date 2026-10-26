import { appendLeadLog } from "../domain/leadLog";
import { readSalesManagementTable, statusRangeForRow } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";

// 問い合わせページに営業お断りの記載があったリードを「除外」にして、根拠をリードログに残す
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

  // 根拠は、メモではなく、リードログに残す
  await appendLeadLog(sheets, [
    { leadId, kind: "ステータス変更", text: `${lead.status} → 除外（${note}）` }
  ]);
};
