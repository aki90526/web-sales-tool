import fs from "fs";
import path from "path";
import { loadConfig } from "../config/env";
import { SHEETS } from "../domain/lead";
import { appendLeadLog, formatLogTime, LEAD_LOG_HEADER, LeadLogEntry } from "../domain/leadLog";
import { columnLetter, fieldRangeForRow, readSalesManagementTable } from "../google/salesManagementRepository";
import { createSheetsClient } from "../google/sheetsClient";

// 「リードログ」シートと、営業管理の「現在の状況」の列を用意し、メモにあるシステムの履歴の行を、ログへ移す。
//  - 移す行: ステータス変更・見送りの再確認・再送対象・連絡先の自動取得／除外／差し替え・要確認・配信停止の検知
//  - 操作者が書いた内容や、AIの所見などは、メモに残す
//  - アプローチ履歴（送信・返信・不達）も、ログに写す（ログが空のときだけ）
//  - 移す前に、メモの全文を .tmp/backups に保存する
//  何度実行しても、同じ結果になる（移す行が無ければ何もしない）。 --dry-run で、書き込まずに内容だけ確認できる。

const dryRun = process.argv.includes("--dry-run");

type Rule = { prefix: RegExp; kind: string };

const RULES: Rule[] = [
  { prefix: /^ステータス変更:\s*/, kind: "ステータス変更" },
  { prefix: /^見送りの再確認:\s*/, kind: "再確認" },
  { prefix: /^再送対象:\s*/, kind: "再送" },
  { prefix: /^連絡先を自動取得:\s*/, kind: "連絡先" },
  { prefix: /^メール出典（自動取得）:\s*/, kind: "連絡先" },
  { prefix: /^連絡先除外:\s*/, kind: "連絡先" },
  { prefix: /^連絡先差し替え:\s*/, kind: "連絡先" },
  { prefix: /^連絡先の候補 .*登録しませんでした$/, kind: "連絡先" },
  { prefix: /^要確認:\s*/, kind: "不具合" },
  { prefix: /^配信停止・営業お断りの返信を検知:\s*/, kind: "返信・検知" }
];

const FINGERPRINT = /\[フォーム指紋:([0-9a-f]{6,16})\]/;

// 行に含まれる日付（2026-10-26 / 2026-10-26 14:41 / 20260915）を、ログの日時にする。無ければ移行した時刻
const dateOf = (line: string, fallback: string): string => {
  const dated = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(line);

  if (dated) {
    return `${dated[1]}-${dated[2]}-${dated[3]} ${dated[4] ?? "00"}:${dated[5] ?? "00"}:00`;
  }

  const compact = /(\d{4})(\d{2})(\d{2})/.exec(line);

  return compact ? `${compact[1]}-${compact[2]}-${compact[3]} 00:00:00` : fallback;
};

const main = async (): Promise<void> => {
  const sheets = await createSheetsClient(loadConfig());
  const migratedAt = formatLogTime();

  // 1. シートと列
  if (!dryRun) {
    const created = await sheets.ensureSheet(SHEETS.leadLog, LEAD_LOG_HEADER.length);

    if (created) {
      await sheets.updateValues(`'${SHEETS.leadLog}'!A1:F1`, [LEAD_LOG_HEADER]);
      console.log(`シート「${SHEETS.leadLog}」を作成しました`);
    }
  }

  let table = await readSalesManagementTable(sheets);

  if (table.columns.currentNote < 0) {
    const headers = table.headers;
    const column = headers.length;

    if (!dryRun) {
      await sheets.ensureColumns(SHEETS.salesManagement, column + 1);
      await sheets.updateValues(`'${SHEETS.salesManagement}'!${columnLetter(column)}1`, [["現在の状況"]]);
      table = await readSalesManagementTable(sheets);
    }

    console.log("営業管理に「現在の状況」の列を追加しました");
  }

  // 2. メモの履歴の行を、ログへ
  const existingLogRows = dryRun ? [] : await sheets.getValues(`'${SHEETS.leadLog}'!A2:F`);
  const logWasEmpty = existingLogRows.length === 0;
  const entries: LeadLogEntry[] = [];
  const memoUpdates: Array<{ rowNumber: number; memo: string }> = [];
  const backup: Record<string, string> = {};

  for (const lead of table.leads) {
    const keep: string[] = [];
    let moved = 0;

    for (const line of lead.memo.split("\n")) {
      const rule = RULES.find((entry) => entry.prefix.test(line));

      if (!rule) {
        keep.push(line);
        continue;
      }

      const fingerprint = FINGERPRINT.exec(line)?.[1];
      const text = line
        .replace(rule.prefix, "")
        .replace(FINGERPRINT, "")
        .trim();

      entries.push({
        at: dateOf(line, migratedAt),
        leadId: lead.leadId,
        kind: rule.kind,
        text: rule.kind === "ステータス変更" ? text.replace(/\s*\(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?\)/, "") : text,
        actor: "自動",
        detail: fingerprint ? `フォーム指紋:${fingerprint}` : ""
      });
      moved += 1;
    }

    if (moved > 0) {
      backup[lead.leadId] = lead.memo;
      memoUpdates.push({ rowNumber: lead.rowNumber, memo: keep.join("\n").trim() });
    }
  }

  // 3. アプローチ履歴（送信・返信・不達）も、ログに写す（ログが空のときだけ）
  if (logWasEmpty || dryRun) {
    const history = await sheets.getValues(`'${SHEETS.approachHistory}'!A2:J`);

    for (const row of history) {
      const leadId = String(row[0] ?? "").trim();

      if (!leadId || String(row[7] ?? "").trim() !== "送信済み") {
        continue;
      }

      const sentAt = dateOf(String(row[1] ?? ""), migratedAt);
      const method = String(row[2] ?? "").trim();
      const subject = String(row[4] ?? "").trim();
      const reply = String(row[8] ?? "").trim();

      entries.push({ at: sentAt, leadId, kind: "送信", text: `${method}で送信${subject ? `（${subject}）` : ""}`, actor: "自動", detail: "" });

      if (reply && reply !== "未返信") {
        entries.push({ at: sentAt, leadId, kind: "返信・検知", text: `返信状況: ${reply}`, actor: "自動", detail: "" });
      }
    }
  }

  console.log(`ログに移す件数: ${entries.length}（メモを書き換えるリード: ${memoUpdates.length}）`);
  entries.slice(0, 6).forEach((entry) => console.log(`  ${entry.at} ${entry.leadId} [${entry.kind}] ${entry.text.slice(0, 60)}`));

  if (dryRun) {
    console.log("(dry-run: 書き込みはしていません)");
    return;
  }

  if (memoUpdates.length > 0) {
    const dir = path.resolve(__dirname, "../../.tmp/backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `memo-before-leadlog-${migratedAt.replace(/[ :]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log(`メモのバックアップ: ${file}`);
  }

  // 日時の順に、まとめて追記する
  entries.sort((a, b) => a.at.localeCompare(b.at));

  for (let index = 0; index < entries.length; index += 200) {
    await appendLeadLog(sheets, entries.slice(index, index + 200));
  }

  for (const update of memoUpdates) {
    await sheets.updateValues(fieldRangeForRow(table.columns, "memo", update.rowNumber), [[update.memo]]);
  }

  console.log("完了しました");
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
