import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { loadConfig } from "../config/env";
import { excludeLeadForSalesForbidden } from "../form/formSalesForbiddenNote";
import { appendCaptchaNote } from "../form/formCaptchaNote";
import { appendFormOutcome, domainOf } from "../form/formOutcomeLog";
import { upsertFormWatchEntry } from "../form/formWatchStatus";
import { findFormCandidates, FormCandidate, FormSkipReason } from "../contact/formCandidates";
import { readSalesContentConfig } from "../contact/salesMessage";
import { fillCandidateFormsInBrowser } from "../form/browserFormAutofill";
import { saveLastFormFillSession } from "../form/formFillSession";
import { fieldRangeForRow, readSalesManagementTable } from "../google/salesManagementRepository";
import { createSheetsClient, SheetsClient } from "../google/sheetsClient";

type CliOptions = {
  dryRun: boolean;
  help: boolean;
  leadId: string;
  leadIds: string[];
  limit: number;
  port: number;
  timeoutMs: number;
  autoConfirm: boolean;
};

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 5;
const DEFAULT_PORT = 9222;
const DEFAULT_TIMEOUT_MS = 15000;

const printHelp = (): void => {
  console.log(`Usage:
  npm run forms:fill -- --limit 1
  npm run forms:fill -- --lead-id L-0004
  npm run forms:fill -- --lead-ids L-0004,L-0005
  npm run forms:fill -- --dry-run --limit 3

Options:
  --lead-id      指定したリードIDのフォームだけ開いて自動入力します
  --lead-ids     複数のリードID（カンマ区切り、最大 ${MAX_LIMIT} 件）のフォームを開いて自動入力します
  --limit        自動入力する最大件数。省略時は ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}
  --dry-run      ブラウザを開かず、対象候補だけ表示します
  --no-auto-confirm  入力後に「確認」ボタンを自動で押さず、入力だけで止めます
  --port         Chrome remote debugging port。省略時は ${DEFAULT_PORT}
  --timeout-ms   ページ読み込み待ち時間。省略時は ${DEFAULT_TIMEOUT_MS}
`);
};

const nextValue = (args: string[], index: number, name: string): string => {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
};

const parsePositiveInteger = (value: string, name: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    dryRun: false,
    help: false,
    leadId: "",
    leadIds: [],
    limit: DEFAULT_LIMIT,
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    autoConfirm: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--lead-id") {
      options.leadId = nextValue(argv, index, "--lead-id");
      index += 1;
    } else if (arg === "--lead-ids") {
      options.leadIds = Array.from(new Set(nextValue(argv, index, "--lead-ids").split(",").map((id) => id.trim()).filter(Boolean)));
      index += 1;
    } else if (arg === "--limit") {
      options.limit = parsePositiveInteger(nextValue(argv, index, "--limit"), "--limit");
      index += 1;
    } else if (arg === "--no-auto-confirm") {
      options.autoConfirm = false;
    } else if (arg === "--port") {
      options.port = parsePositiveInteger(nextValue(argv, index, "--port"), "--port");
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(nextValue(argv, index, "--timeout-ms"), "--timeout-ms");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.limit > MAX_LIMIT) {
    throw new Error(`--limit must be ${MAX_LIMIT} or less`);
  }

  if (options.leadIds.length > MAX_LIMIT) {
    throw new Error(`--lead-ids must be ${MAX_LIMIT} or less`);
  }

  return options;
};

const filterCandidates = (
  candidates: FormCandidate[],
  options: CliOptions
): FormCandidate[] => {
  if (options.leadIds.length > 0) {
    // 指定された順に、対象になるものだけを返す
    return options.leadIds
      .map((leadId) => candidates.find((candidate) => candidate.leadId === leadId))
      .filter((candidate): candidate is FormCandidate => candidate !== undefined);
  }

  if (!options.leadId) {
    return candidates.slice(0, options.limit);
  }

  return candidates.filter((candidate) => candidate.leadId === options.leadId).slice(0, 1);
};

const printCandidates = (candidates: FormCandidate[]): void => {
  console.log(`Eligible form leads: ${candidates.length}`);

  candidates.forEach((candidate, index) => {
    console.log("");
    console.log(`#${index + 1} ${candidate.leadId} ${candidate.companyName}`);
    console.log(`Row: ${candidate.rowNumber}`);
    console.log(`Score: ${candidate.salesScore}`);
    console.log(`Template: ${candidate.templateId}`);
    console.log(`Form URL: ${candidate.formUrl}`);
    console.log(`Subject: ${candidate.subject}`);
  });
};

const printSkippedSummary = (skipped: Map<FormSkipReason, number>): void => {
  if (skipped.size === 0) {
    return;
  }

  console.log("");
  console.log("Skipped rows:");
  skipped.forEach((count, reason) => {
    console.log(`- ${reason}: ${count}`);
  });
};

const startCompletionWatcher = (
  port: number,
  entries: Array<{ leadId: string; companyName: string; formUrl: string; targetId: string; baseline: unknown }>
): void => {
  if (entries.length === 0) {
    return;
  }

  const watchDir = path.resolve(process.cwd(), ".tmp");
  const watchFile = path.join(watchDir, `form-watch-${Date.now()}.json`);

  fs.mkdirSync(watchDir, { recursive: true });
  fs.writeFileSync(
    watchFile,
    `${JSON.stringify({ port, entries }, null, 2)}\n`,
    "utf8"
  );

  entries.forEach((entry) => upsertFormWatchEntry(entry.leadId, entry.companyName, { state: "watching", startedAt: new Date().toISOString() }));

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "forms:watch", "--", watchFile], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore"
  });

  child.unref();
  console.log(`送信完了の自動検知を開始しました（最大90分、ログ: .tmp/form-watch.log）`);
};

// 指定されたリードが対象にならない理由を、いまのシートの状態から説明する（画面に表示される）
const explainIneligible = async (sheets: SheetsClient, leadIds: string[]): Promise<string> => {
  const table = await readSalesManagementTable(sheets);
  const reasons = leadIds.map((leadId) => {
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) return `${leadId}: シートに見つかりません`;
    if (lead.status !== "送信待ち") return `${leadId}: すでに「${lead.status}」で、送信待ちではありません`;
    if (lead.contactMethod !== "フォーム") return `${leadId}: 連絡方法がフォームではありません（${lead.contactMethod}）`;
    if (!/^https?:\/\//i.test(lead.contactFormUrl)) return `${leadId}: フォームURLがありません`;
    if (lead.memo.includes("[CAPTCHA]")) return `${leadId}: CAPTCHAがあるため、自動入力の対象外です`;
    return `${leadId}: 次回対応日（${lead.nextActionDate}）がまだ先です`;
  });

  return reasons.join(" / ");
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const sheets = await createSheetsClient(config);
  const contentConfig = await readSalesContentConfig(sheets);
  const candidateLimit = options.leadId || options.leadIds.length > 0 ? 1000 : options.limit;
  const { candidates, skipped } = await findFormCandidates(sheets, candidateLimit, contentConfig);
  const targets = filterCandidates(candidates, options);

  if (options.leadId && targets.length === 0) {
    throw new Error(`No eligible form lead found for ${options.leadId}（${await explainIneligible(sheets, [options.leadId])}）。画面を再読み込みして、候補を更新してください`);
  }

  if (options.leadIds.length > 0) {
    const missing = options.leadIds.filter((leadId) => !targets.some((target) => target.leadId === leadId));

    if (targets.length === 0) {
      throw new Error(
        `No eligible form lead found for ${options.leadIds.join(", ")}（${await explainIneligible(sheets, options.leadIds)}）。画面を再読み込みして、候補を更新してください`
      );
    }

    if (missing.length > 0) {
      console.log(`対象外のためスキップ: ${await explainIneligible(sheets, missing)}`);
    }
  }

  console.log("Form autofill: this command opens Chrome, fills the forms and advances to the confirm step. It never clicks the final submit button.");
  printCandidates(targets);
  printSkippedSummary(skipped);

  if (targets.length === 0 || options.dryRun) {
    return;
  }

  const results = await fillCandidateFormsInBrowser(
    targets,
    contentConfig.sender,
    contentConfig.formFieldAliases,
    {
      chromePort: options.port,
      timeoutMs: options.timeoutMs,
      autoConfirm: options.autoConfirm
    }
  );

  for (const { candidate, result, confirm, wrongPage, salesForbidden, finalUrl } of results) {
    if (salesForbidden) {
      console.log("");
      console.log(`Skipped ${candidate.leadId} ${candidate.companyName}: 営業お断りの記載を検出したため入力せず、ステータスを「除外」にしました。`);
      console.log(`Detected text: ${salesForbidden}`);
      await excludeLeadForSalesForbidden(sheets, candidate.leadId, salesForbidden, finalUrl);
      console.log(`[DASHBOARD_WARNING] leadId=${candidate.leadId} message=営業お断りの記載（「${salesForbidden}」）を検出したため、入力せずに「除外」にしました`);
      console.log(`[DASHBOARD_UPDATE] leadId=${candidate.leadId} company=${candidate.companyName} type=salesforbidden detail=「${salesForbidden}」`);
      continue;
    }

    saveLastFormFillSession({
      leadId: candidate.leadId,
      companyName: candidate.companyName,
      formUrl: candidate.formUrl,
      filledAt: new Date().toISOString()
    });

    console.log("");
    console.log(`Filled ${candidate.leadId} ${candidate.companyName}`);
    console.log(`[DASHBOARD_LEAD] leadId=${candidate.leadId} companyName=${candidate.companyName}`);
    console.log(`Text fields: ${result.filled.length}`);
    console.log(`Selects/radios: ${result.selected.length}`);
    console.log(`Consent checkboxes: ${result.checked.length}`);
    result.warnings.forEach((warning) => {
      console.log(`Warning: ${warning}`);
      console.log(`[DASHBOARD_WARNING] leadId=${candidate.leadId} message=${warning}`);
    });
    console.log(`Confirm step: ${confirm.status}${confirm.label ? ` (${confirm.label})` : ""}${confirm.detail ? ` - ${confirm.detail}` : ""}`);
    if (confirm.status === "advanced") {
      console.log(`[DASHBOARD_CONFIRM] leadId=${candidate.leadId} status=advanced`);
    }

    if (wrongPage) {
      appendFormOutcome({
        leadId: candidate.leadId,
        companyName: candidate.companyName,
        domain: domainOf(candidate.formUrl),
        kind: "wrong-page",
        detail: result.warnings[result.warnings.length - 1]
      });
    }

    if (result.captcha) {
      appendFormOutcome({
        leadId: candidate.leadId,
        companyName: candidate.companyName,
        domain: domainOf(candidate.formUrl),
        kind: "captcha",
        detail: result.captcha
      });
      console.log(`Captcha detected: ${result.captcha} (自動送信不可の可能性が高いため手動対応推奨)`);
      await appendCaptchaNote(sheets, candidate.leadId, result.captcha);
      console.log(`メモに記録しました: [CAPTCHA] ${result.captcha}`);
      console.log(`[DASHBOARD_CAPTCHA] leadId=${candidate.leadId} label=${result.captcha}`);
    }

    console.log(`送信後: npm run forms:mark-sent（送信完了画面を検知した場合は自動で記録します）`);
  }

  startCompletionWatcher(
    options.port,
    results
      .filter(({ wrongPage }) => !wrongPage)
      .map(({ candidate, targetId, baseline }) => ({
      leadId: candidate.leadId,
      companyName: candidate.companyName,
      formUrl: candidate.formUrl,
      targetId,
      baseline
    }))
  );
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
