import { execFile } from "child_process";
import { loadConfig } from "../config/env";
import { buildSalesBody, buildSalesSubject, CONTACT_SENDER } from "../contact/salesMessage";
import { SHEETS } from "../domain/lead";
import { createSheetsClient, SheetsClient } from "../google/sheetsClient";

type CliOptions = {
  help: boolean;
  limit: number;
  minScore?: number;
  open: boolean;
};

type FormCandidate = {
  rowNumber: number;
  leadId: string;
  companyName: string;
  leadType: string;
  formUrl: string;
  salesScore: number;
  recommendedApproach: string;
  subject: string;
  body: string;
};

type SkipReason =
  | "ステータスが送信待ちではない"
  | "次回対応日が未来"
  | "連絡方法が問い合わせフォームではない"
  | "フォームURLが空またはURL形式ではない"
  | "営業メッセージ案が空"
  | "営業スコアが基準未満";

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;
const DEFAULT_MIN_SCORE = 50;

const COL = {
  leadId: 0,
  companyName: 1,
  leadType: 2,
  contactMethod: 6,
  formUrl: 7,
  salesScore: 9,
  recommendedApproach: 11,
  salesMessageDraft: 12,
  status: 13,
  nextActionDate: 15
} as const;

const printHelp = (): void => {
  console.log(`Usage:
  npm run forms:todo
  npm run forms:todo -- --limit 3
  npm run forms:todo -- --limit 1 --open

Options:
  --limit       表示する最大件数。省略時は ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}
  --min-score   最低営業スコア。省略時は 設定 シートの値、未設定時は ${DEFAULT_MIN_SCORE}
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

const cell = (row: unknown[], index: number): string => {
  const value = row[index];
  return value === undefined || value === null ? "" : String(value).trim();
};

const parseScore = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isValidUrl = (value: string): boolean => {
  return /^https?:\/\//i.test(value);
};

const formatTokyoDate = (date: Date): string => {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

const isFutureDate = (dateText: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return false;
  }

  return dateText > formatTokyoDate(new Date());
};

const readMinScore = async (sheets: SheetsClient, cliMinScore?: number): Promise<number> => {
  if (cliMinScore !== undefined) {
    return cliMinScore;
  }

  const rows = await sheets.getValues(`'${SHEETS.settings}'!A2:B50`);
  const minScoreRow = rows.find((row) => cell(row, 0) === "最低営業スコア");
  const settingValue = minScoreRow ? parseScore(cell(minScoreRow, 1)) : 0;

  return settingValue > 0 ? settingValue : DEFAULT_MIN_SCORE;
};

const toCandidate = (
  row: unknown[],
  rowNumber: number,
  minScore: number
): { candidate?: FormCandidate; reason?: SkipReason } => {
  const leadId = cell(row, COL.leadId);

  if (!leadId) {
    return {};
  }

  const status = cell(row, COL.status);
  const contactMethod = cell(row, COL.contactMethod);
  const formUrl = cell(row, COL.formUrl);
  const salesMessageDraft = cell(row, COL.salesMessageDraft);
  const salesScore = parseScore(cell(row, COL.salesScore));
  const nextActionDate = cell(row, COL.nextActionDate);

  if (status !== "送信待ち") {
    return { reason: "ステータスが送信待ちではない" };
  }

  if (isFutureDate(nextActionDate)) {
    return { reason: "次回対応日が未来" };
  }

  if (contactMethod !== "問い合わせフォーム") {
    return { reason: "連絡方法が問い合わせフォームではない" };
  }

  if (!isValidUrl(formUrl)) {
    return { reason: "フォームURLが空またはURL形式ではない" };
  }

  if (!salesMessageDraft) {
    return { reason: "営業メッセージ案が空" };
  }

  if (salesScore < minScore) {
    return { reason: "営業スコアが基準未満" };
  }

  const leadType = cell(row, COL.leadType);
  const recommendedApproach = cell(row, COL.recommendedApproach);

  return {
    candidate: {
      rowNumber,
      leadId,
      companyName: cell(row, COL.companyName),
      leadType,
      formUrl,
      salesScore,
      recommendedApproach,
      subject: buildSalesSubject(leadType, recommendedApproach),
      body: buildSalesBody(salesMessageDraft)
    }
  };
};

const findCandidates = async (
  sheets: SheetsClient,
  limit: number,
  minScore: number
): Promise<{ candidates: FormCandidate[]; skipped: Map<SkipReason, number> }> => {
  const rows = await sheets.getValues(`'${SHEETS.salesManagement}'!A2:Q1000`);
  const skipped = new Map<SkipReason, number>();
  const candidates: FormCandidate[] = [];

  rows.forEach((row, index) => {
    if (candidates.length >= limit) {
      return;
    }

    const result = toCandidate(row, index + 2, minScore);

    if (result.candidate) {
      candidates.push(result.candidate);
      return;
    }

    if (result.reason) {
      skipped.set(result.reason, (skipped.get(result.reason) ?? 0) + 1);
    }
  });

  return { candidates, skipped };
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

const printCandidate = (candidate: FormCandidate, index: number): void => {
  console.log("");
  console.log(`#${index + 1} ${candidate.leadId} ${candidate.companyName}`);
  console.log(`Row: ${candidate.rowNumber}`);
  console.log(`Score: ${candidate.salesScore}`);
  console.log(`Form URL: ${candidate.formUrl}`);
  console.log("");
  console.log("Form fields:");
  console.log(`会社名: ${CONTACT_SENDER.companyName}`);
  console.log(`氏名: ${CONTACT_SENDER.name}`);
  console.log(`メールアドレス: ${CONTACT_SENDER.email}`);
  console.log(`電話番号: ${CONTACT_SENDER.tel}`);
  console.log(`URL: ${CONTACT_SENDER.url}`);
  console.log(`件名: ${candidate.subject}`);
  console.log("");
  console.log("本文:");
  console.log(candidate.body);
  console.log("");
  console.log(`送信後: npm run forms:mark-sent -- --lead-id ${candidate.leadId}`);
};

const printSkippedSummary = (skipped: Map<SkipReason, number>): void => {
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
  const minScore = await readMinScore(sheets, options.minScore);
  const { candidates, skipped } = await findCandidates(sheets, options.limit, minScore);

  console.log("Form submission todo: this command does not submit forms.");
  console.log(`Eligible form leads: ${candidates.length}`);
  console.log(`Minimum sales score: ${minScore}`);

  candidates.forEach(printCandidate);
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
