import { execFile } from "child_process";
import { loadConfig } from "../config/env";
import {
  readSalesContentConfig,
  SenderInfo
} from "../contact/salesMessage";
import {
  DEFAULT_FORM_MIN_SCORE,
  findFormCandidates,
  FormCandidate,
  FormSkipReason,
  readFormMinScore,
  scoreThresholdForFormCandidate
} from "../contact/formCandidates";
import { createSheetsClient } from "../google/sheetsClient";

type CliOptions = {
  help: boolean;
  limit: number;
  minScore?: number;
  open: boolean;
};

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

const printHelp = (): void => {
  console.log(`Usage:
  npm run forms:todo
  npm run forms:todo -- --limit 3
  npm run forms:todo -- --limit 1 --open

Options:
  --limit       表示する最大件数。省略時は ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}
  --min-score   最低営業スコア。省略時は 設定 シートの値、未設定時は ${DEFAULT_FORM_MIN_SCORE}
  --open        対象フォームURLを既定ブラウザで開きます。送信はしません
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
    help: false,
    limit: DEFAULT_LIMIT,
    open: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--limit") {
      options.limit = parsePositiveInteger(nextValue(argv, index, "--limit"), "--limit");
      index += 1;
    } else if (arg === "--min-score") {
      options.minScore = parsePositiveInteger(nextValue(argv, index, "--min-score"), "--min-score");
      index += 1;
    } else if (arg === "--open") {
      options.open = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.limit > MAX_LIMIT) {
    throw new Error(`--limit must be ${MAX_LIMIT} or less`);
  }

  return options;
};

const openUrl = async (url: string): Promise<void> => {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  await new Promise<void>((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const printCandidate = (candidate: FormCandidate, index: number, sender: SenderInfo): void => {
  console.log("");
  console.log(`#${index + 1} ${candidate.leadId} ${candidate.companyName}`);
  console.log(`Row: ${candidate.rowNumber}`);
  console.log(`Score: ${candidate.salesScore}`);
  console.log(`Template: ${candidate.templateId}`);
  console.log(`Form URL: ${candidate.formUrl}`);
  console.log("");
  console.log("Form fields:");
  console.log(`会社名: ${sender.companyName}`);
  console.log(`氏名: ${sender.name}`);
  console.log(`メールアドレス: ${sender.email}`);
  console.log(`電話番号: ${sender.tel}`);
  console.log(`URL: ${sender.url}`);
  console.log(`件名: ${candidate.subject}`);
  console.log("");
  console.log("本文:");
  console.log(candidate.body);
  console.log("");
  console.log(`送信後: npm run forms:mark-sent -- --lead-id ${candidate.leadId}`);
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
  const minScore = await readFormMinScore(sheets, options.minScore);
  const { candidates, skipped } = await findFormCandidates(sheets, options.limit, minScore, contentConfig);

  console.log("Form submission todo: this command does not submit forms.");
  console.log(`Eligible form leads: ${candidates.length}`);
  console.log(
    `Minimum sales score: ${minScore} (Web制作会社/広告代理店: ${scoreThresholdForFormCandidate("Web制作会社", minScore)})`
  );

  candidates.forEach((candidate, index) => printCandidate(candidate, index, contentConfig.sender));
  printSkippedSummary(skipped);

  if (options.open) {
    for (const candidate of candidates) {
      await openUrl(candidate.formUrl);
    }
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
