import { appendLeadLog } from "./leadLog";
import { readSalesManagementTable, statusRangeForRow } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";
import { SHEETS } from "./lead";
import { readResendSettings, readSendRecords, resendDueDate, daysBetween, todayInTokyo } from "./resend";

export type ResendRevert = {
  leadId: string;
  companyName: string;
  lastSentAt: string;
  elapsedDays: number;
  sentCount: number;
};

// 返信・反応があったリードは、再送の対象にしない（履歴のどこかに返信があれば除く）
const REACTED_REPLY_STATUSES = new Set(["返信あり", "再送案内"]);

const readReactedLeadIds = async (sheets: SheetsClient): Promise<Set<string>> => {
  const rows = await sheets.getValues(`'${SHEETS.approachHistory}'!A2:J`);
  const ids = new Set<string>();

  rows.forEach((row) => {
    if (REACTED_REPLY_STATUSES.has(String(row[8] ?? "").trim())) {
      ids.add(String(row[0] ?? "").trim());
    }
  });

  return ids;
};

const formatMonthDay = (dateText: string): string => {
  const [, month, day] = dateText.split("-").map(Number);
  return `${month}月${day}日`;
};

// 送信済みで、再送の期日を過ぎ、反応のないリードを「送信待ち」に戻す。実際の送信は行わない。
// 対象外: 送信済み以外（返信あり・面談済み・商談中・保留・除外などはそもそも送信済みではない）、返信履歴のあるリード
export const revertDueResends = async (
  sheets: SheetsClient,
  options: { dryRun: boolean; today?: string }
): Promise<ResendRevert[]> => {
  const today = options.today ?? todayInTokyo();
  const [table, settings, records, reacted] = await Promise.all([
    readSalesManagementTable(sheets),
    readResendSettings(sheets),
    readSendRecords(sheets),
    readReactedLeadIds(sheets)
  ]);
  const reverted: ResendRevert[] = [];

  for (const lead of table.leads) {
    if (lead.status !== "送信済み" || reacted.has(lead.leadId)) {
      continue;
    }

    const record = records.get(lead.leadId);
    const due = resendDueDate(record, settings);

    if (!record || !due || due > today) {
      continue;
    }

    const elapsedDays = daysBetween(record.lastSentAt, today);
    const line = `前回送信${formatMonthDay(record.lastSentAt)}から${elapsedDays}日経過`;

    if (!options.dryRun) {
      await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [["送信待ち"]]);
      await appendLeadLog(sheets, [
        { leadId: lead.leadId, kind: "再送", text: `再送の時期になりました（${line}）` },
        { leadId: lead.leadId, kind: "ステータス変更", text: "送信済み → 送信待ち（再送の時期）" }
      ]);
    }

    reverted.push({
      leadId: lead.leadId,
      companyName: lead.companyName,
      lastSentAt: record.lastSentAt,
      elapsedDays,
      sentCount: record.count
    });
  }

  return reverted;
};
