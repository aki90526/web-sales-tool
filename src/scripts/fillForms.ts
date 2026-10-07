import { loadConfig } from "../config/env";
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
  limit: number;
  port: number;
  timeoutMs: number;
};

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 5;
const DEFAULT_PORT = 9222;
const DEFAULT_TIMEOUT_MS = 15000;

const printHelp = (): void => {
  console.log(`Usage:
  npm run forms:fill -- --limit 1
  npm run forms:fill -- --lead-id L-0004
  npm run forms:fill -- --dry-run --limit 3

Options:
  --lead-id      指定したリードIDのフォームだけ開いて自動入力します
  --limit        自動入力する最大件数。省略時は ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}
  --dry-run      ブラウザを開かず、対象候補だけ表示します
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
    limit: DEFAULT_LIMIT,
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS
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
    } else if (arg === "--limit") {
      options.limit = parsePositiveInteger(nextValue(argv, index, "--limit"), "--limit");
      index += 1;
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

  return options;
};

const filterCandidates = (
  candidates: FormCandidate[],
  options: CliOptions
): FormCandidate[] => {
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

const appendCaptchaNote = async (
  sheets: SheetsClient,
  leadId: string,
  captchaLabel: string
): Promise<void> => {
  const table = await readSalesManagementTable(sheets);
  const lead = table.leads.find((entry) => entry.leadId === leadId);

  if (!lead) {
    return;
  }

  const note = `[CAPTCHA] ${captchaLabel}`;

  if (lead.memo.includes(note)) {
    return;
  }

  const nextMemo = lead.memo ? `${lead.memo}\n${note}` : note;
  await sheets.updateValues(fieldRangeForRow(table.columns, "memo", lead.rowNumber), [[nextMemo]]);
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

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const sheets = await createSheetsClient(config);
  const contentConfig = await readSalesContentConfig(sheets);
  const candidateLimit = options.leadId ? 1000 : options.limit;
  const { candidates, skipped } = await findFormCandidates(sheets, candidateLimit, contentConfig);
  const targets = filterCandidates(candidates, options);

  if (options.leadId && targets.length === 0) {
    throw new Error(`No eligible form lead found for ${options.leadId}`);
  }

  console.log("Form autofill: this command opens Chrome and does not submit forms.");
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
      timeoutMs: options.timeoutMs
    }
  );

  for (const { candidate, result } of results) {
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
    result.warnings.forEach((warning) => console.log(`Warning: ${warning}`));

    if (result.captcha) {
      console.log(`Captcha detected: ${result.captcha} (自動送信不可の可能性が高いため手動対応推奨)`);
      await appendCaptchaNote(sheets, candidate.leadId, result.captcha);
      console.log(`メモに記録しました: [CAPTCHA] ${result.captcha}`);
      console.log(`[DASHBOARD_CAPTCHA] leadId=${candidate.leadId} label=${result.captcha}`);
    }

    console.log(`送信後: npm run forms:mark-sent`);
  }
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
