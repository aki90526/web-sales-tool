import { DEFAULT_RESEND_SETTINGS, RESEND_SETTING_KEYS, SHEETS } from "../domain/lead";
import { readResendSettings, ResendSettings } from "../domain/resend";
import { SheetsClient } from "../google/sheetsClient";

// アプリの「設定」画面が読み書きする内容。値はスプレッドシート（設定シート・メッセージテンプレートシート）にあり、画面とシートのどちらで変えても同じ。

export type FollowUpTemplateView = {
  templateId: string;
  templateName: string;
  targetLeadTypes: string;
  channel: "メール" | "フォーム" | "";
  status: string;
  subject: string;
  body: string;
};

export type AppSettingsView = {
  intervals: ResendSettings;
  followUps: FollowUpTemplateView[];
};

export type AppSettingsUpdate = {
  intervals?: Partial<ResendSettings>;
  followUps?: Array<{ templateId: string; subject: string; body: string }>;
};

const MAX_DAYS = 3650;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 5000;

const text = (row: unknown[], index: number): string => String(row[index] ?? "").trim();

export const readAppSettings = async (sheets: SheetsClient): Promise<AppSettingsView> => {
  const [intervals, rows] = await Promise.all([
    readResendSettings(sheets),
    sheets.getValues(`'${SHEETS.messageTemplates}'!A2:L100`)
  ]);
  const followUps = rows
    .filter((row) => text(row, 10) === "再送" && text(row, 0))
    .map((row): FollowUpTemplateView => {
      const channel = text(row, 11);

      return {
        templateId: text(row, 0),
        templateName: text(row, 1),
        targetLeadTypes: text(row, 2),
        channel: channel === "メール" || channel === "フォーム" ? channel : "",
        status: text(row, 7),
        // 本文は改行や前後の空白もそのまま画面に出す
        subject: String(row[4] ?? ""),
        body: String(row[5] ?? "")
      };
    });

  return { intervals, followUps };
};

const parseDays = (value: unknown, label: string): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DAYS) {
    throw new Error(`${label}は、1〜${MAX_DAYS}の整数で指定してください`);
  }

  return parsed;
};

const writeSettingValue = async (sheets: SheetsClient, key: string, value: number, memo: string): Promise<void> => {
  const rows = await sheets.getValues(`'${SHEETS.settings}'!A1:C200`);
  const index = rows.findIndex((row) => text(row, 0) === key);

  if (index >= 0) {
    await sheets.updateValues(`'${SHEETS.settings}'!B${index + 1}`, [[value]]);
    return;
  }

  await sheets.updateValues(`'${SHEETS.settings}'!A${rows.length + 1}:C${rows.length + 1}`, [[key, value, memo]]);
};

const tokyoDate = (): string => {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
};

export const saveAppSettings = async (sheets: SheetsClient, update: AppSettingsUpdate): Promise<void> => {
  // 先に、すべての入力を検証してから書き込む（途中まで保存されるのを避ける）
  const intervalWrites: Array<{ key: string; value: number; memo: string }> = [];

  if (update.intervals?.firstIntervalDays !== undefined) {
    intervalWrites.push({
      key: RESEND_SETTING_KEYS.firstIntervalDays,
      value: parseDays(update.intervals.firstIntervalDays, "初回の再送間隔"),
      memo: "初回の再送までの日数"
    });
  }

  if (update.intervals?.laterIntervalDays !== undefined) {
    intervalWrites.push({
      key: RESEND_SETTING_KEYS.laterIntervalDays,
      value: parseDays(update.intervals.laterIntervalDays, "2回目以降の再送間隔"),
      memo: `2回目以降の再送までの日数（既定 ${DEFAULT_RESEND_SETTINGS.laterIntervalDays}）`
    });
  }

  if (update.intervals?.recheckIntervalDays !== undefined) {
    intervalWrites.push({
      key: RESEND_SETTING_KEYS.recheckIntervalDays,
      value: parseDays(update.intervals.recheckIntervalDays, "見送りの再確認間隔"),
      memo: "見送りのリードを再確認する間隔（日数）"
    });
  }

  const rows = await sheets.getValues(`'${SHEETS.messageTemplates}'!A2:L100`);
  const templateWrites: Array<{ rowNumber: number; subject: string; body: string }> = [];

  for (const entry of update.followUps ?? []) {
    const index = rows.findIndex((row) => text(row, 0) === entry.templateId && text(row, 10) === "再送");

    if (index < 0) {
      throw new Error(`再送用のテンプレートが見つかりません: ${entry.templateId}`);
    }

    if (typeof entry.subject !== "string" || typeof entry.body !== "string") {
      throw new Error("件名と本文は文字列で指定してください");
    }

    const subject = entry.subject.trim();
    const body = entry.body.replace(/\r\n/g, "\n").trim();

    if (!subject || !body) {
      throw new Error(`${entry.templateId}: 件名と本文は空にできません`);
    }

    if (subject.length > MAX_SUBJECT_LENGTH || body.length > MAX_BODY_LENGTH) {
      throw new Error(`${entry.templateId}: 件名は${MAX_SUBJECT_LENGTH}文字、本文は${MAX_BODY_LENGTH}文字までです`);
    }

    templateWrites.push({ rowNumber: index + 2, subject, body });
  }

  for (const write of intervalWrites) {
    await writeSettingValue(sheets, write.key, write.value, write.memo);
  }

  for (const write of templateWrites) {
    await sheets.updateValues(`'${SHEETS.messageTemplates}'!E${write.rowNumber}:F${write.rowNumber}`, [[write.subject, write.body]]);
    await sheets.updateValues(`'${SHEETS.messageTemplates}'!I${write.rowNumber}`, [[tokyoDate()]]);
  }
};
