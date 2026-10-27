import { DEFAULT_RESEND_SETTINGS, RESEND_SETTING_KEYS, SHEETS } from "./lead";
import { SheetsClient } from "../google/sheetsClient";

export type ResendSettings = {
  firstIntervalDays: number;
  laterIntervalDays: number;
  recheckIntervalDays: number;
  // 見送りが2回目以降のリードの、再確認の間隔
  recheckLaterIntervalDays: number;
};

export type SendRecord = {
  // 「送信済み」のアプローチ履歴の件数（再送を含む）
  count: number;
  // 最後に送信した日（YYYY-MM-DD）
  lastSentAt: string;
};

const parseDays = (value: unknown, fallback: number): number => {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const readResendSettings = async (sheets: SheetsClient): Promise<ResendSettings> => {
  const rows = await sheets.getValues(`'${SHEETS.settings}'!A2:C100`);
  const values = new Map<string, string>();

  rows.forEach((row) => {
    const key = String(row[0] ?? "").trim();

    if (key) {
      values.set(key, String(row[1] ?? "").trim());
    }
  });

  return {
    firstIntervalDays: parseDays(values.get(RESEND_SETTING_KEYS.firstIntervalDays), DEFAULT_RESEND_SETTINGS.firstIntervalDays),
    laterIntervalDays: parseDays(values.get(RESEND_SETTING_KEYS.laterIntervalDays), DEFAULT_RESEND_SETTINGS.laterIntervalDays),
    recheckIntervalDays: parseDays(values.get(RESEND_SETTING_KEYS.recheckIntervalDays), DEFAULT_RESEND_SETTINGS.recheckIntervalDays),
    recheckLaterIntervalDays: parseDays(values.get(RESEND_SETTING_KEYS.recheckLaterIntervalDays), DEFAULT_RESEND_SETTINGS.recheckLaterIntervalDays)
  };
};

// シートの日付表記（2026-08-27 / 2026/8/27 14:41:00 など）を YYYY-MM-DD にそろえる。読み取れなければ空文字。
export const normalizeDateText = (value: unknown): string => {
  const match = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(value ?? ""));

  if (!match) {
    return "";
  }

  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
};

export const readSendRecords = async (sheets: SheetsClient): Promise<Map<string, SendRecord>> => {
  const rows = await sheets.getValues(`'${SHEETS.approachHistory}'!A2:J`);
  const records = new Map<string, SendRecord>();

  rows.forEach((row) => {
    const leadId = String(row[0] ?? "").trim();

    // 不達（届いていない）送信は、送ったことに数えない
    if (!leadId || String(row[7] ?? "").trim() !== "送信済み" || String(row[8] ?? "").trim() === "不達") {
      return;
    }

    const sentAt = normalizeDateText(row[1]);
    const current = records.get(leadId) ?? { count: 0, lastSentAt: "" };

    records.set(leadId, {
      count: current.count + 1,
      lastSentAt: sentAt > current.lastSentAt ? sentAt : current.lastSentAt
    });
  });

  return records;
};

// 次の再送までの日数。1回送っていれば初回の間隔、2回以上送っていれば「2回目以降」の間隔。
export const resendIntervalDays = (sentCount: number, settings: ResendSettings): number => {
  return sentCount <= 1 ? settings.firstIntervalDays : settings.laterIntervalDays;
};

export const addDaysToDateText = (dateText: string, days: number): string => {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return date.toISOString().slice(0, 10);
};

export const todayInTokyo = (now: Date = new Date()): string => {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
};

export const daysBetween = (fromDate: string, toDate: string): number => {
  const parse = (text: string): number => {
    const [year, month, day] = text.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };

  return Math.floor((parse(toDate) - parse(fromDate)) / 86_400_000);
};

// 再送の期日（YYYY-MM-DD）。送信記録がなければ空文字。
export const resendDueDate = (record: SendRecord | undefined, settings: ResendSettings): string => {
  if (!record || record.count === 0 || !record.lastSentAt) {
    return "";
  }

  return addDaysToDateText(record.lastSentAt, resendIntervalDays(record.count, settings));
};
