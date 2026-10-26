import { SHEETS } from "./lead";
import { SheetsClient } from "../google/sheetsClient";

// リードごとのログ（スプレッドシートの「リードログ」シート。追記専用）。
// メモは「いまの最新の情報」を見るための欄で、履歴の置き場所ではない。システムの動きと操作者の更新は、ここに残す。

export const LEAD_LOG_KINDS = [
  "登録",
  "ステータス変更",
  "送信",
  "自動入力",
  "返信・検知",
  "再送",
  "再確認",
  "連絡先",
  "不具合",
  "状況",
  "その他"
] as const;

export type LeadLogKind = (typeof LEAD_LOG_KINDS)[number];

export type LeadLogEntry = {
  at: string;
  leadId: string;
  kind: string;
  text: string;
  // 自動（システム）/ 手入力（操作者）
  actor: string;
  // 補助の情報（フォームの指紋など）
  detail: string;
};

export const LEAD_LOG_HEADER = ["日時", "リードID", "種類", "内容", "記録者", "詳細"];

export const formatLogTime = (date: Date = new Date()): string => {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
};

// 日時は、シートが日付の値に変えてしまわないよう、文字として書く（先頭の ' は、シートに表示されない）
const toRow = (entry: Omit<LeadLogEntry, "at"> & { at?: string }): unknown[] => [
  `'${entry.at ?? formatLogTime()}`,
  entry.leadId,
  entry.kind,
  entry.text,
  entry.actor,
  entry.detail
];

// ログを追記する。ログの書き込みに失敗しても、本来の処理（ステータス変更など）は止めない
export const appendLeadLog = async (
  sheets: SheetsClient,
  entries: Array<Omit<LeadLogEntry, "at" | "actor" | "detail"> & { at?: string; actor?: string; detail?: string }>
): Promise<void> => {
  if (entries.length === 0) {
    return;
  }

  try {
    await sheets.appendValues(
      `'${SHEETS.leadLog}'!A:F`,
      entries.map((entry) => toRow({ ...entry, actor: entry.actor ?? "自動", detail: entry.detail ?? "" }))
    );
  } catch (error: unknown) {
    console.error(`リードログの追記に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const parseRow = (row: unknown[]): LeadLogEntry => ({
  at: String(row[0] ?? "").trim(),
  leadId: String(row[1] ?? "").trim(),
  kind: String(row[2] ?? "").trim(),
  text: String(row[3] ?? "").trim(),
  actor: String(row[4] ?? "").trim(),
  detail: String(row[5] ?? "").trim()
});

// シートが無い（移行前の）ときは、空として扱う
export const readAllLeadLogs = async (sheets: SheetsClient): Promise<LeadLogEntry[]> => {
  try {
    const rows = await sheets.getValues(`'${SHEETS.leadLog}'!A2:F`);
    return rows.map(parseRow).filter((entry) => entry.leadId);
  } catch {
    return [];
  }
};

export const readLeadLog = async (sheets: SheetsClient, leadId: string): Promise<LeadLogEntry[]> => {
  return (await readAllLeadLogs(sheets))
    .filter((entry) => entry.leadId === leadId)
    .sort((a, b) => b.at.localeCompare(a.at));
};

// リードごとの、いちばん新しいログ
export const latestLogByLead = (entries: LeadLogEntry[]): Map<string, LeadLogEntry> => {
  const latest = new Map<string, LeadLogEntry>();

  for (const entry of entries) {
    const current = latest.get(entry.leadId);

    if (!current || entry.at >= current.at) {
      latest.set(entry.leadId, entry);
    }
  }

  return latest;
};

// 見送りの再確認で使う: 最後に確認した日（再確認、または見送りにした日）と、フォームの指紋
export const recheckStateFromLog = (entries: LeadLogEntry[]): { lastDate: string; fingerprint: string } => {
  let lastDate = "";
  let fingerprint = "";

  for (const entry of [...entries].sort((a, b) => a.at.localeCompare(b.at))) {
    const isRecheck = entry.kind === "再確認";
    const isSkip = entry.kind === "ステータス変更" && /→\s*見送り/.test(entry.text);

    if (isRecheck || isSkip) {
      lastDate = entry.at.slice(0, 10);
    }

    const match = /フォーム指紋:([0-9a-f]{6,16})/.exec(entry.detail);

    if (isRecheck && match) {
      fingerprint = match[1];
    }
  }

  return { lastDate, fingerprint };
};
