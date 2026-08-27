import { loadConfig, requireSmtpConfig } from "../config/env";
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
  contactMethod: string;
  contact: string;
  salesScore: number;
  recommendedApproach: string;
  salesMessageDraft: string;
  subject: string;
  body: string;
};

type SkipReason =
  | "ステータスが送信待ちではない"
  | "連絡方法がメールではない"
  | "連絡先がメール形式ではない"
  | "営業メッセージ案が空"
  | "営業スコアが基準未満";

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 10;
const DEFAULT_MIN_SCORE = 50;

const COL = {
  leadId: 0,
  companyName: 1,
  leadType: 2,
  contactMethod: 6,
  contact: 7,
  salesScore: 8,
  recommendedApproach: 10,
  salesMessageDraft: 11,
  status: 12
} as const;

const SIGNATURE = [
  "aaWebCreate",
  "阿部 祥士 / Abe Akihito",
  "TEL : 09062121580",
  "チャットワークID : abeAawc",
  "Email : abe@aawebcreate.com",
  "URL : https://aawebcreate.com/"
].join("\n");

const OPT_OUT_NOTICE =
  "※今後このようなご連絡が不要な場合は、お手数ですが本メールへの返信にてお知らせください。以後のご連絡を控えます。";

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

const buildSubject = (leadType: string, recommendedApproach: string): string => {
  if (leadType === "広告代理店" || leadType === "Web制作会社") {
    return "Web制作・コーディングの外部パートナーについて";
  }

  if (recommendedApproach === "LP制作") {
    return "貴社Webサイト・LP改善について";
  }

  if (recommendedApproach === "保守・更新" || recommendedApproach === "WordPress改修") {
    return "貴社Webサイトの更新・改善について";
  }

  return "貴社Webサイトの改善について";
};

const buildBody = (draft: string): string => {
  const parts = [draft.trim()];

  if (!draft.includes("今後このようなご連絡が不要") && !draft.includes("以後のご連絡を控え")) {
    parts.push(OPT_OUT_NOTICE);
  }

  if (!draft.includes("aaWebCreate") || !draft.includes("abe@aawebcreate.com")) {
    parts.push(SIGNATURE);
  }

  return parts.join("\n\n");
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
): { candidate?: SalesEmailCandidate; reason?: SkipReason } => {
  const leadId = cell(row, COL.leadId);

  if (!leadId) {
    return {};
  }

  const status = cell(row, COL.status);
  const contactMethod = cell(row, COL.contactMethod);
  const contact = cell(row, COL.contact);
  const salesMessageDraft = cell(row, COL.salesMessageDraft);
  const salesScore = parseScore(cell(row, COL.salesScore));

  if (status !== "送信待ち") {
    return { reason: "ステータスが送信待ちではない" };
  }

  if (contactMethod !== "メール") {
    return { reason: "連絡方法がメールではない" };
  }

  if (!isValidEmail(contact)) {
    return { reason: "連絡先がメール形式ではない" };
  }

  if (!salesMessageDraft) {
    return { reason: "営業メッセージ案が空" };
  }

  if (salesScore < minScore) {
    return { reason: "営業スコアが基準未満" };
  }

  const leadType = cell(row, COL.leadType);
  const recommendedApproach = cell(row, COL.recommendedApproach);
  const subject = buildSubject(leadType, recommendedApproach);

  return {
    candidate: {
      rowNumber,
      leadId,
      companyName: cell(row, COL.companyName),
      leadType,
      contactMethod,
      contact,
      salesScore,
      recommendedApproach,
      salesMessageDraft,
      subject,
      body: buildBody(salesMessageDraft)
    }
  };
};

const findCandidates = async (
  sheets: SheetsClient,
  limit: number,
  minScore: number
): Promise<{ candidates: SalesEmailCandidate[]; skipped: Map<SkipReason, number> }> => {
  const rows = await sheets.getValues(`'${SHEETS.salesManagement}'!A2:P1000`);
  const skipped = new Map<SkipReason, number>();
  const candidates: SalesEmailCandidate[] = [];

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

const printCandidates = (candidates: SalesEmailCandidate[], minScore: number): void => {
  console.log(`Eligible email leads: ${candidates.length}`);
  console.log(`Minimum sales score: ${minScore}`);

  candidates.forEach((candidate, index) => {
    console.log("");
    console.log(`#${index + 1} ${candidate.leadId} ${candidate.companyName}`);
    console.log(`Row: ${candidate.rowNumber}`);
    console.log(`To: ${candidate.contact}`);
    console.log(`Score: ${candidate.salesScore}`);
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
      candidate.contact,
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
  await sheets.updateValues(`'${SHEETS.salesManagement}'!M${rowNumber}:M${rowNumber}`, [["送信済み"]]);
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
    console.log(`Sending ${candidate.leadId} ${candidate.companyName} to ${candidate.contact}...`);
    const result = await mailer.send({
      to: candidate.contact,
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
