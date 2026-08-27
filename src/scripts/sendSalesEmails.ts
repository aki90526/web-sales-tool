import { loadConfig, requireSmtpConfig } from "../config/env";
import { buildSalesMessage, readSalesContentConfig, SalesContentConfig } from "../contact/salesMessage";
import { SHEETS } from "../domain/lead";
import { createSmtpMailer } from "../email/smtpMailer";
import { createSheetsClient, SheetsClient } from "../google/sheetsClient";

type CliOptions = {
  dryRun: boolean;
  help: boolean;
  limit: number;
  minScore?: number;
};

type SalesEmailCandidate = {
  rowNumber: number;
  leadId: string;
  companyName: string;
  leadType: string;
  industry: string;
  region: string;
  officialSiteUrl: string;
  contactMethod: string;
  emailAddress: string;
  salesScore: number;
  salesAngle: string;
  recommendedApproach: string;
  salesMessageDraft: string;
  subject: string;
  body: string;
  templateId: string;
};

type SkipReason =
  | "ステータスが送信待ちではない"
  | "次回対応日が未来"
  | "連絡方法がメールではない"
  | "メールアドレスが空またはメール形式ではない"
  | "営業メッセージ案が空"
  | "営業スコアが基準未満";

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 10;
const DEFAULT_MIN_SCORE = 50;

const COL = {
  leadId: 0,
  companyName: 1,
  leadType: 2,
  industry: 3,
  region: 4,
  officialSiteUrl: 5,
  contactMethod: 6,
  emailAddress: 8,
  salesScore: 9,
  salesAngle: 10,
  recommendedApproach: 11,
  salesMessageDraft: 12,
  status: 13,
  nextActionDate: 15
} as const;

const printHelp = (): void => {
  console.log(`Usage:
  npm run send:emails -- --dry-run --limit 3
  npm run send:emails -- --limit 1

Options:
  --dry-run       送信せず、対象候補だけ表示します
  --limit         送信または表示する最大件数。省略時は ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}
  --min-score     最低営業スコア。省略時は 設定 シートの値、未設定時は ${DEFAULT_MIN_SCORE}
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
    limit: DEFAULT_LIMIT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--limit") {
      options.limit = parsePositiveInteger(nextValue(argv, index, "--limit"), "--limit");
      index += 1;
    } else if (arg === "--min-score") {
      options.minScore = parsePositiveInteger(nextValue(argv, index, "--min-score"), "--min-score");
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

const cell = (row: unknown[], index: number): string => {
  const value = row[index];
  return value === undefined || value === null ? "" : String(value).trim();
};

const parseScore = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isValidEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const formatTokyoDate = (date: Date): string => {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

const formatTokyoDateTime = (date: Date): string => {
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
  minScore: number,
  contentConfig: SalesContentConfig
): { candidate?: SalesEmailCandidate; reason?: SkipReason } => {
  const leadId = cell(row, COL.leadId);

  if (!leadId) {
    return {};
  }

  const status = cell(row, COL.status);
  const contactMethod = cell(row, COL.contactMethod);
  const emailAddress = cell(row, COL.emailAddress);
  const salesMessageDraft = cell(row, COL.salesMessageDraft);
  const salesScore = parseScore(cell(row, COL.salesScore));
  const nextActionDate = cell(row, COL.nextActionDate);

  if (status !== "送信待ち") {
    return { reason: "ステータスが送信待ちではない" };
  }

  if (isFutureDate(nextActionDate)) {
    return { reason: "次回対応日が未来" };
  }

  if (contactMethod !== "メール") {
    return { reason: "連絡方法がメールではない" };
  }

  if (!isValidEmail(emailAddress)) {
    return { reason: "メールアドレスが空またはメール形式ではない" };
  }

  if (!salesMessageDraft) {
    return { reason: "営業メッセージ案が空" };
  }

  if (salesScore < minScore) {
    return { reason: "営業スコアが基準未満" };
  }

  const leadType = cell(row, COL.leadType);
  const recommendedApproach = cell(row, COL.recommendedApproach);
  const message = buildSalesMessage(
    {
      companyName: cell(row, COL.companyName),
      leadType,
      industry: cell(row, COL.industry),
      region: cell(row, COL.region),
      officialSiteUrl: cell(row, COL.officialSiteUrl),
      salesAngle: cell(row, COL.salesAngle),
      recommendedApproach,
      salesMessageDraft
    },
    contentConfig
  );

  return {
    candidate: {
      rowNumber,
      leadId,
      companyName: cell(row, COL.companyName),
      leadType,
      industry: cell(row, COL.industry),
      region: cell(row, COL.region),
      officialSiteUrl: cell(row, COL.officialSiteUrl),
      contactMethod,
      emailAddress,
      salesScore,
      salesAngle: cell(row, COL.salesAngle),
      recommendedApproach,
      salesMessageDraft,
      subject: message.subject,
      body: message.body,
      templateId: message.templateId
    }
  };
};

const findCandidates = async (
  sheets: SheetsClient,
  limit: number,
  minScore: number,
  contentConfig: SalesContentConfig
): Promise<{ candidates: SalesEmailCandidate[]; skipped: Map<SkipReason, number> }> => {
  const rows = await sheets.getValues(`'${SHEETS.salesManagement}'!A2:Q1000`);
  const skipped = new Map<SkipReason, number>();
  const candidates: SalesEmailCandidate[] = [];

  rows.forEach((row, index) => {
    if (candidates.length >= limit) {
      return;
    }

    const result = toCandidate(row, index + 2, minScore, contentConfig);

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

const printCandidates = (candidates: SalesEmailCandidate[], minScore: number): void => {
  console.log(`Eligible email leads: ${candidates.length}`);
  console.log(`Minimum sales score: ${minScore}`);

  candidates.forEach((candidate, index) => {
    console.log("");
    console.log(`#${index + 1} ${candidate.leadId} ${candidate.companyName}`);
    console.log(`Row: ${candidate.rowNumber}`);
    console.log(`To: ${candidate.emailAddress}`);
    console.log(`Score: ${candidate.salesScore}`);
    console.log(`Template: ${candidate.templateId}`);
    console.log(`Subject: ${candidate.subject}`);
    console.log("Message preview:");
    console.log(candidate.body);
  });
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

const appendApproachHistory = async (
  sheets: SheetsClient,
  candidate: SalesEmailCandidate,
  messageId: string,
  sentAt: string
): Promise<void> => {
  await sheets.appendValues(`'${SHEETS.approachHistory}'!A:J`, [
    [
      candidate.leadId,
      sentAt,
      "メール",
      candidate.emailAddress,
      candidate.subject,
      candidate.body,
      "承認",
      "送信済み",
      "未返信",
      `SMTP Message ID: ${messageId}`
    ]
  ]);
};

const markLeadAsSent = async (sheets: SheetsClient, rowNumber: number): Promise<void> => {
  await sheets.updateValues(`'${SHEETS.salesManagement}'!N${rowNumber}:N${rowNumber}`, [["送信済み"]]);
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
  const minScore = await readMinScore(sheets, options.minScore);
  const { candidates, skipped } = await findCandidates(sheets, options.limit, minScore, contentConfig);

  if (options.dryRun) {
    console.log("Dry run: no emails will be sent and sheets will not be updated.");
    printCandidates(candidates, minScore);
    printSkippedSummary(skipped);
    return;
  }

  if (candidates.length === 0) {
    console.log("No eligible email leads found. Nothing was sent.");
    printSkippedSummary(skipped);
    return;
  }

  const smtpConfig = requireSmtpConfig(config);
  const mailer = createSmtpMailer(smtpConfig);

  console.log(`Verifying SMTP connection for ${smtpConfig.user}...`);
  await mailer.verify();

  for (const candidate of candidates) {
    console.log(`Sending ${candidate.leadId} ${candidate.companyName} to ${candidate.emailAddress}...`);
    const result = await mailer.send({
      to: candidate.emailAddress,
      subject: candidate.subject,
      text: candidate.body
    });
    const sentAt = formatTokyoDateTime(new Date());

    await appendApproachHistory(sheets, candidate, result.messageId, sentAt);
    await markLeadAsSent(sheets, candidate.rowNumber);

    console.log(`Sent ${candidate.leadId}. Message ID: ${result.messageId}`);
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
