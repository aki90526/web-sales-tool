import { SHEETS } from "../domain/lead";
import { SheetsClient } from "../google/sheetsClient";

// 設定シートの項目名。空欄のときは .env の SMTP_FROM / SMTP_BCC を使う。
// （SMTPのサーバー・アカウント・パスワードは、秘密情報のため .env のまま。設定画面では扱わない）
export const MAIL_SETTING_KEYS = {
  from: "メール_送信元(From)",
  bcc: "メール_BCC"
} as const;

export type MailOverrides = { from?: string; bcc?: string };

export const readMailOverrides = async (sheets: SheetsClient): Promise<MailOverrides> => {
  const rows = await sheets.getValues(`'${SHEETS.settings}'!A2:C200`);
  const values = new Map<string, string>();

  rows.forEach((row) => {
    const key = String(row[0] ?? "").trim();

    if (key) {
      values.set(key, String(row[1] ?? "").trim());
    }
  });

  return {
    from: values.get(MAIL_SETTING_KEYS.from) || undefined,
    bcc: values.get(MAIL_SETTING_KEYS.bcc) || undefined
  };
};
