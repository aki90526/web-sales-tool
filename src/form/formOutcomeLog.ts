import fs from "fs";
import path from "path";

// フォーム送信の結果の種類（傾向の集計用）
export type FormOutcomeKind =
  | "success" // 送信完了画面を検知して、送信済みにした
  | "spam" // スパム判定（reCAPTCHA等）で弾かれた
  | "invalid" // 入力内容に問題があると返された
  | "failed" // 送信に失敗した（その他のエラー）
  | "captcha" // CAPTCHAがあり、自動入力の対象外になった
  | "wrong-page" // フォームがない・転送されたなど、本物のフォームではなかった
  | "needs-confirm" // 完了画面がなく、送信できたか要確認
  | "closed" // タブが閉じられ、結果が分からない
  | "timeout"; // 時間内に結果を検知できなかった

export type FormOutcome = {
  at: string;
  leadId: string;
  companyName: string;
  domain: string;
  kind: FormOutcomeKind;
  detail?: string;
};

const logPath = path.resolve(process.cwd(), "data", "form-outcomes.json");
const MAX_ENTRIES = 1000;

export const readFormOutcomes = (): FormOutcome[] => {
  try {
    const parsed = JSON.parse(fs.readFileSync(logPath, "utf8")) as unknown;

    return Array.isArray(parsed) ? (parsed as FormOutcome[]) : [];
  } catch {
    return [];
  }
};

export const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export const appendFormOutcome = (entry: Omit<FormOutcome, "at"> & { at?: string }): void => {
  const entries = readFormOutcomes();

  entries.push({ ...entry, at: entry.at ?? new Date().toISOString() });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const tempPath = `${logPath}.${process.pid}.tmp`;

  fs.writeFileSync(tempPath, `${JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, logPath);
};
