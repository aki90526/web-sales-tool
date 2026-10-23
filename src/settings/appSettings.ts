import { DEFAULT_RESEND_SETTINGS, RESEND_SETTING_KEYS, SHEETS } from "../domain/lead";
import { readResendSettings, ResendSettings } from "../domain/resend";
import { CONTACT_SENDER } from "../contact/salesMessage";
import { SheetsClient } from "../google/sheetsClient";

// アプリの「設定」画面が読み書きする内容。値はスプレッドシート（設定シート・メッセージテンプレートシート）にあり、画面とシートのどちらで変えても同じ。

export type TemplateView = {
  templateId: string;
  templateName: string;
  purpose: "初回" | "再送";
  targetLeadTypes: string;
  channel: "メール" | "フォーム" | "";
  status: string;
  subject: string;
  body: string;
};

// 送信者情報・署名・案内文など、設定シートの「項目名 / 値」で持つ文字の設定
export type TextSettingDef = {
  key: string;
  label: string;
  group: "送信者" | "署名・案内";
  multiline?: boolean;
  hint?: string;
  fallback: string;
};

export const TEXT_SETTINGS: TextSettingDef[] = [
  { key: "送信者_会社名", label: "会社名・屋号", group: "送信者", fallback: CONTACT_SENDER.companyName },
  { key: "送信者_氏名", label: "氏名", group: "送信者", fallback: CONTACT_SENDER.name },
  { key: "送信者_ローマ字", label: "氏名（ローマ字）", group: "送信者", fallback: CONTACT_SENDER.nameRoman },
  { key: "送信者_氏名カナ", label: "氏名（カタカナ）", group: "送信者", fallback: CONTACT_SENDER.nameKana },
  { key: "送信者_氏名ひらがな", label: "氏名（ひらがな）", group: "送信者", fallback: CONTACT_SENDER.nameHiragana },
  { key: "送信者_会社名カナ", label: "会社名（カタカナ）", group: "送信者", fallback: CONTACT_SENDER.companyNameKana },
  { key: "送信者_部署名", label: "部署・役職", group: "送信者", fallback: CONTACT_SENDER.department },
  { key: "送信者_メール", label: "メールアドレス", group: "送信者", fallback: CONTACT_SENDER.email, hint: "フォームの入力と署名に使います（送信元は .env の SMTP 設定）" },
  { key: "送信者_電話番号", label: "電話番号", group: "送信者", fallback: CONTACT_SENDER.tel },
  { key: "送信者_URL", label: "サイトURL", group: "送信者", fallback: CONTACT_SENDER.url },
  { key: "送信者_実績URL", label: "実績・プロフィールURL", group: "送信者", fallback: CONTACT_SENDER.portfolioUrl },
  { key: "送信者_チャットワークID", label: "チャットワークID", group: "送信者", fallback: CONTACT_SENDER.chatworkId },
  { key: "送信者_年齢", label: "年齢", group: "送信者", fallback: CONTACT_SENDER.age },
  { key: "送信者_事業内容", label: "事業内容", group: "送信者", fallback: CONTACT_SENDER.businessDescription },
  { key: "送信者_郵便番号", label: "郵便番号", group: "送信者", fallback: CONTACT_SENDER.postalCode },
  { key: "送信者_都道府県", label: "都道府県", group: "送信者", fallback: CONTACT_SENDER.prefecture },
  { key: "送信者_市区町村", label: "市区町村", group: "送信者", fallback: CONTACT_SENDER.city },
  { key: "送信者_以降の住所", label: "番地以降", group: "送信者", fallback: CONTACT_SENDER.streetAddress },
  { key: "送信者_住所", label: "住所（短い表記）", group: "送信者", fallback: CONTACT_SENDER.address, hint: "文面の差し込み {送信者_住所} に使います" },
  { key: "送信者_フォーム住所", label: "住所（署名・フォーム用）", group: "送信者", fallback: CONTACT_SENDER.formAddress, hint: "署名と、フォームの住所欄に使います" },
  { key: "署名_紹介文", label: "署名の紹介文", group: "署名・案内", fallback: CONTACT_SENDER.signatureTagline, hint: "署名の1行目「会社名 | ○○」の○○の部分。空欄にすると会社名だけになります" },
  { key: "配信停止の案内文", label: "配信停止の案内文", group: "署名・案内", multiline: true, fallback: CONTACT_SENDER.optOutNotice, hint: "文面に配信停止の案内が無いときに、自動で付きます（特定電子メール法のため、残すことをおすすめします）" }
];

export type TextSettingView = TextSettingDef & { value: string };

export type AppSettingsView = {
  intervals: ResendSettings;
  textSettings: TextSettingView[];
  templates: TemplateView[];
};

export type AppSettingsUpdate = {
  intervals?: Partial<ResendSettings>;
  // キー: 設定シートの項目名（TEXT_SETTINGS にあるものだけ）
  textSettings?: Record<string, string>;
  templates?: Array<{ templateId: string; subject: string; body: string }>;
};

const MAX_DAYS = 3650;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 5000;
const MAX_TEXT_LENGTH = 500;

const text = (row: unknown[], index: number): string => String(row[index] ?? "").trim();

export const readAppSettings = async (sheets: SheetsClient): Promise<AppSettingsView> => {
  const [intervals, settingRows, rows] = await Promise.all([
    readResendSettings(sheets),
    sheets.getValues(`'${SHEETS.settings}'!A2:C200`),
    sheets.getValues(`'${SHEETS.messageTemplates}'!A2:L100`)
  ]);
  const values = new Map<string, string>();

  settingRows.forEach((row) => {
    const key = text(row, 0);

    if (key) {
      values.set(key, String(row[1] ?? ""));
    }
  });

  // シートに項目が無い・空欄のときは、アプリの既定値を表示する（保存すると、シートに書かれる）
  const textSettings = TEXT_SETTINGS.map((def): TextSettingView => ({ ...def, value: values.get(def.key) || def.fallback }));
  const templates = rows
    .filter((row) => text(row, 0) && text(row, 4) && text(row, 5))
    .map((row): TemplateView => {
      const channel = text(row, 11);

      return {
        templateId: text(row, 0),
        templateName: text(row, 1),
        purpose: text(row, 10) === "再送" ? "再送" : "初回",
        targetLeadTypes: text(row, 2),
        channel: channel === "メール" || channel === "フォーム" ? channel : "",
        status: text(row, 7),
        // 本文は改行や前後の空白もそのまま画面に出す
        subject: String(row[4] ?? ""),
        body: String(row[5] ?? "")
      };
    });

  return { intervals, textSettings, templates };
};

const parseDays = (value: unknown, label: string): number => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DAYS) {
    throw new Error(`${label}は、1〜${MAX_DAYS}の整数で指定してください`);
  }

  return parsed;
};

const writeSettingValue = async (sheets: SheetsClient, key: string, value: string | number, memo: string): Promise<void> => {
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

  const textWrites: Array<{ def: TextSettingDef; value: string }> = [];

  for (const [key, rawValue] of Object.entries(update.textSettings ?? {})) {
    const def = TEXT_SETTINGS.find((entry) => entry.key === key);

    if (!def) {
      throw new Error(`変更できない設定項目です: ${key}`);
    }

    if (typeof rawValue !== "string") {
      throw new Error(`${def.label}は文字で指定してください`);
    }

    const value = rawValue.replace(/\r\n/g, "\n").trim();

    if (value.length > MAX_TEXT_LENGTH) {
      throw new Error(`${def.label}は${MAX_TEXT_LENGTH}文字までです`);
    }

    // 署名の紹介文だけは空欄にできる。ほかは、空欄にすると送信内容が欠けるため不可
    if (!value && def.key !== "署名_紹介文") {
      throw new Error(`${def.label}は空にできません`);
    }

    textWrites.push({ def, value });
  }

  const rows = await sheets.getValues(`'${SHEETS.messageTemplates}'!A2:L100`);
  const templateWrites: Array<{ rowNumber: number; subject: string; body: string }> = [];

  for (const entry of update.templates ?? []) {
    const index = rows.findIndex((row) => text(row, 0) === entry.templateId);

    if (index < 0) {
      throw new Error(`テンプレートが見つかりません: ${entry.templateId}`);
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

  for (const write of textWrites) {
    await writeSettingValue(sheets, write.def.key, write.value, write.def.label);
  }

  for (const write of templateWrites) {
    await sheets.updateValues(`'${SHEETS.messageTemplates}'!E${write.rowNumber}:F${write.rowNumber}`, [[write.subject, write.body]]);
    await sheets.updateValues(`'${SHEETS.messageTemplates}'!I${write.rowNumber}`, [[tokyoDate()]]);
  }
};
