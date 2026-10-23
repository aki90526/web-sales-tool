import { recheckRejectedLeads } from "../collection/rejectedRecheck";
import { loadConfig } from "../config/env";
import { createSheetsClient } from "../google/sheetsClient";

const printHelp = (): void => {
  console.log(`Usage:
  npm run leads:recheck-rejected -- --dry-run
  npm run leads:recheck-rejected -- --limit 15
  npm run leads:recheck-rejected -- --lead-ids L-0007,L-0043

「見送り」のリードの公式サイト・連絡先を再確認し、連絡先を確認できたものを「送信待ち」に戻します。
「除外」と、返信のあったリードは対象外です。確認の間隔は 設定シートの「見送り再確認間隔日数」です。

Options:
  --dry-run    シートを更新せず、結果だけ表示します
  --limit      1回で確認する件数の上限（既定 15）
  --lead-ids   対象のリードID（カンマ区切り）。間隔に関係なく確認します
`);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const dryRun = args.includes("--dry-run");
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 15;
  const idsIndex = args.indexOf("--lead-ids");
  const leadIds = idsIndex >= 0 ? (args[idsIndex + 1] ?? "").split(",").map((id) => id.trim()).filter(Boolean) : undefined;

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }

  const sheets = await createSheetsClient(loadConfig());
  const results = await recheckRejectedLeads(sheets, { dryRun, limit, leadIds });

  console.log(`Rejected lead recheck${dryRun ? " (dry-run)" : ""}: ${results.length} checked, ${results.filter((r) => r.outcome === "revived").length} revived`);

  for (const result of results) {
    console.log(`${result.leadId} ${result.companyName}: ${result.outcome === "revived" ? "→ 送信待ち" : "見送りのまま"} / ${result.detail}`);

    if (result.outcome === "revived") {
      console.log(`[DASHBOARD_UPDATE] leadId=${result.leadId} company=${result.companyName} type=recheck-revived detail=${result.detail}`);
    }
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
