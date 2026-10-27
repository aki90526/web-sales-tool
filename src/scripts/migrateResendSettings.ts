import { loadConfig } from "../config/env";
import { FOLLOW_UP_DEFAULTS } from "../contact/salesMessage";
import { buildContactCountFormula, buildNextActionDateFormula, DEFAULT_RESEND_SETTINGS, RESEND_SETTING_KEYS, SHEETS } from "../domain/lead";
import { columnLetter } from "../google/salesManagementRepository";
import { createSheetsClient } from "../google/sheetsClient";

// 再送・見送り再確認の機能に必要なシートの準備を行う（何度実行しても同じ結果になる）。
//  1. 設定シートに「再送間隔日数（2回目以降）」「見送り再確認間隔日数」の行を追加
//  2. メッセージテンプレートシートに「用途」「連絡方法」の列と、再送用の文面（4行）を追加
//  3. 営業管理の「次回対応日」の数式を、送信回数に応じた間隔で計算するものに更新
//  4. 営業管理に「連絡回数」（数式）「再確認までの日数」の列を用意する

const dryRun = process.argv.includes("--dry-run");

const TODAY = new Date().toISOString().slice(0, 10);

const main = async (): Promise<void> => {
  const sheets = await createSheetsClient(loadConfig());
  const write = async (range: string, values: unknown[][], allowFormulas = false): Promise<void> => {
    if (dryRun) {
      console.log(`[dry-run] ${range} <- ${values.length}行`);
      return;
    }

    await sheets.updateValues(range, values, { allowFormulas });
  };

  // 1. 設定シート
  const settingsRows = await sheets.getValues(`'${SHEETS.settings}'!A1:C100`);
  const existingKeys = new Set(settingsRows.map((row) => String(row[0] ?? "").trim()));
  const additions: unknown[][] = [];

  if (!existingKeys.has(RESEND_SETTING_KEYS.laterIntervalDays)) {
    additions.push([
      RESEND_SETTING_KEYS.laterIntervalDays,
      DEFAULT_RESEND_SETTINGS.laterIntervalDays,
      "2回目以降の再送までの日数（前回送信日からの日数。営業管理の次回対応日に使用）"
    ]);
  }

  if (!existingKeys.has(RESEND_SETTING_KEYS.recheckIntervalDays)) {
    additions.push([
      RESEND_SETTING_KEYS.recheckIntervalDays,
      DEFAULT_RESEND_SETTINGS.recheckIntervalDays,
      "見送りのリードを再確認する間隔（日数）"
    ]);
  }

  if (!existingKeys.has(RESEND_SETTING_KEYS.recheckLaterIntervalDays)) {
    additions.push([
      RESEND_SETTING_KEYS.recheckLaterIntervalDays,
      DEFAULT_RESEND_SETTINGS.recheckLaterIntervalDays,
      "見送りが2回目以降のリードを再確認する間隔（日数）"
    ]);
  }

  if (additions.length > 0) {
    const startRow = settingsRows.length + 1;
    await write(`'${SHEETS.settings}'!A${startRow}:C${startRow + additions.length - 1}`, additions);
    console.log(`設定シートに ${additions.length} 行を追加しました`);
  } else {
    console.log("設定シート: 追加済み");
  }

  // 初回の間隔の説明を、2回目以降との違いが分かる形にする
  await write(`'${SHEETS.settings}'!C2`, [["初回の再送までの日数（1回送信した後、再送するまでの日数。営業管理の次回対応日に使用）"]]);

  // 2. メッセージテンプレートシート
  if (!dryRun) {
    await sheets.ensureColumns(SHEETS.messageTemplates, 12);
  }

  const templateRows = await sheets.getValues(`'${SHEETS.messageTemplates}'!A1:L100`);
  const hasFollowUps = templateRows.slice(1).some((row) => String(row[10] ?? "").trim() === "再送");

  await write(`'${SHEETS.messageTemplates}'!K1:L1`, [["用途", "連絡方法"]]);

  const existingBodyRows = templateRows.slice(1);
  if (existingBodyRows.length > 0) {
    const purposes = existingBodyRows.map((row) => [String(row[10] ?? "").trim() || "初回", String(row[11] ?? "").trim()]);
    await write(`'${SHEETS.messageTemplates}'!K2:L${existingBodyRows.length + 1}`, purposes);
  }

  if (!hasFollowUps) {
    const partnerTypes = "広告代理店 / Web制作会社";
    const placeholders = "{会社名}, {前回送信月}, {前回送信日}, {署名}";
    const rows: unknown[][] = [
      ["TMP-101", "再送 制作会社・広告代理店向け（メール）", partnerTypes, "", FOLLOW_UP_DEFAULTS.partnerEmail.subject, FOLLOW_UP_DEFAULTS.partnerEmail.body, placeholders, "使用中", TODAY, "2回目以降の送信で自動的に使われる。{前回送信月}は前回送信した月に置き換わる。", "再送", "メール"],
      ["TMP-102", "再送 制作会社・広告代理店向け（フォーム）", partnerTypes, "", FOLLOW_UP_DEFAULTS.partnerForm.subject, FOLLOW_UP_DEFAULTS.partnerForm.body, placeholders, "使用中", TODAY, "フォーム用は短め。", "再送", "フォーム"],
      ["TMP-103", "再送 直クライアント向け（メール）", "直クライアント", "", FOLLOW_UP_DEFAULTS.directEmail.subject, FOLLOW_UP_DEFAULTS.directEmail.body, placeholders, "使用中", TODAY, "2回目以降の送信で自動的に使われる。", "再送", "メール"],
      ["TMP-104", "再送 直クライアント向け（フォーム）", "直クライアント", "", FOLLOW_UP_DEFAULTS.directForm.subject, FOLLOW_UP_DEFAULTS.directForm.body, placeholders, "使用中", TODAY, "フォーム用は短め。", "再送", "フォーム"]
    ];
    const startRow = templateRows.length + 1;
    await write(`'${SHEETS.messageTemplates}'!A${startRow}:L${startRow + rows.length - 1}`, rows);
    console.log(`メッセージテンプレートに再送用の文面を ${rows.length} 行追加しました`);
  } else {
    console.log("メッセージテンプレート: 再送用の文面は追加済み");
  }

  // 3. 営業管理の次回対応日
  const managementFormulas = await sheets.getFormulas(`'${SHEETS.salesManagement}'!A:AZ`);
  const headers = (managementFormulas[0] ?? []).map((value) => String(value ?? "").trim());
  const leadIdColumn = headers.indexOf("リードID");
  const lastColumn = headers.indexOf("最終アプローチ日");
  const nextColumn = headers.indexOf("次回対応日");

  if (leadIdColumn === -1 || lastColumn === -1 || nextColumn === -1) {
    throw new Error("営業管理シートに リードID / 最終アプローチ日 / 次回対応日 の列が見つかりません");
  }

  let updated = 0;
  const column = managementFormulas.slice(1).map((row, index) => {
    const rowNumber = index + 2;
    const current = row[nextColumn] ?? "";
    const text = typeof current === "string" ? current : "";

    // 従来の数式（最終アプローチ日 + 設定!B2）だけを、新しい数式に置き換える。手入力の値はそのまま。
    if (/^=IF\(OR\(.*\),"",.*\+'設定'!\$B\$2\)$/.test(text)) {
      updated += 1;
      return [
        buildNextActionDateFormula(`${columnLetter(leadIdColumn)}${rowNumber}`, `${columnLetter(lastColumn)}${rowNumber}`)
      ];
    }

    return [current];
  });

  if (updated > 0) {
    const letter = columnLetter(nextColumn);
    await write(`'${SHEETS.salesManagement}'!${letter}2:${letter}${column.length + 1}`, column, true);
  }

  console.log(`営業管理の次回対応日の数式を更新: ${updated} 行${dryRun ? "（dry-run）" : ""}`);

  // 4. 営業管理の「連絡回数」（数式）と「再確認までの日数」の列
  const renamed = headers.indexOf("見送り回数");
  const workingHeaders = [...headers];

  if (renamed >= 0) {
    workingHeaders[renamed] = "連絡回数";
    await write(`'${SHEETS.salesManagement}'!${columnLetter(renamed)}1`, [["連絡回数"]]);
    console.log("営業管理の列名を「見送り回数」から「連絡回数」に変更しました");
  }

  const newHeaders = ["連絡回数", "再確認までの日数"].filter((name) => !workingHeaders.includes(name));

  if (newHeaders.length > 0) {
    const firstColumn = workingHeaders.length;

    if (!dryRun) {
      await sheets.ensureColumns(SHEETS.salesManagement, firstColumn + newHeaders.length);
    }

    await write(`'${SHEETS.salesManagement}'!${columnLetter(firstColumn)}1:${columnLetter(firstColumn + newHeaders.length - 1)}1`, [newHeaders]);
    workingHeaders.push(...newHeaders);
    console.log(`営業管理に列を追加しました: ${newHeaders.join(" / ")}`);
  }

  // 連絡回数は、アプローチ履歴の「送信済み」（不達を除く）の件数。数式で入れる
  const countColumn = workingHeaders.indexOf("連絡回数");
  const countFormulas = managementFormulas.slice(1).map((_, index) => {
    const rowNumber = index + 2;
    return [buildContactCountFormula(`${columnLetter(leadIdColumn)}${rowNumber}`)];
  });
  const countLetter = columnLetter(countColumn);

  await write(`'${SHEETS.salesManagement}'!${countLetter}2:${countLetter}${countFormulas.length + 1}`, countFormulas, true);
  console.log(`連絡回数の数式を記入: ${countFormulas.length} 行${dryRun ? "（dry-run）" : ""}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
