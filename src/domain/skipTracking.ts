import { fieldRangeForRow, SalesManagementLead, SalesManagementTable } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";

// 見送りのリードごとの「再確認までの日数」（営業管理シートの「再確認までの日数」の列）

export const RECHECK_NEVER = "なし";

export type RecheckSetting = { kind: "default" } | { kind: "never" } | { kind: "days"; days: number };

export const parseRecheckSetting = (raw: string): RecheckSetting => {
  const value = raw.trim();

  if (!value) {
    return { kind: "default" };
  }

  if (value === RECHECK_NEVER) {
    return { kind: "never" };
  }

  const days = Number(value);
  return Number.isInteger(days) && days > 0 ? { kind: "days", days } : { kind: "default" };
};

// API・画面から受け取った値（日数 / "なし" / 空）を、シートに書く文字列にそろえる。不正な値は null。
export const normalizeRecheckInput = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (value === RECHECK_NEVER) {
    return RECHECK_NEVER;
  }

  const days = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isInteger(days) && days >= 1 && days <= 3650 ? String(days) : null;
};

// 列がまだ無いシートでは何もしない（ステータスの変更自体は呼び出し側で行う）
export const setRecheckDays = async (
  sheets: SheetsClient,
  table: SalesManagementTable,
  lead: SalesManagementLead,
  recheckDays: string
): Promise<void> => {
  if (table.columns.recheckDays < 0) {
    return;
  }

  await sheets.updateValues(fieldRangeForRow(table.columns, "recheckDays", lead.rowNumber), [[recheckDays]]);
};

// 見送りでなくなったとき（再確認で送信待ちに戻ったときなど）に、再確認までの日数の指定を消す
export const clearRecheckDays = async (
  sheets: SheetsClient,
  table: SalesManagementTable,
  lead: SalesManagementLead
): Promise<void> => {
  if (table.columns.recheckDays >= 0 && lead.recheckDays) {
    await sheets.updateValues(fieldRangeForRow(table.columns, "recheckDays", lead.rowNumber), [[""]]);
  }
};
