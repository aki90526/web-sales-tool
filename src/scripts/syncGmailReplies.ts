import { loadConfig, requireGmailConfig } from "../config/env";
import { SHEETS, Status } from "../domain/lead";
import {
  columnLetter,
  readSalesManagementTable,
  statusRangeForRow
} from "../google/salesManagementRepository";
import { createGmailClient, GmailClient, GmailMessageMetadata } from "../google/gmailClient";
import { createSheetsClient, SheetsClient } from "../google/sheetsClient";

type CliOptions = {
  dryRun: boolean;
  help: boolean;
  limit: number;
  lookbackDays?: number;
};

type ApproachHistoryRow = {
  rowNumber: number;
  leadId: string;
  sentAt: string;
  method: string;
  recipient: string;
  subject: string;
  sendStatus: string;
  replyStatus: string;
  memo: string;
};

type ReplyMatch = {
  history: ApproachHistoryRow;
  message: GmailMessageMetadata;
  matchType: "message-id" | "subject" | "from-after-sent";
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const printHelp = (): void => {
  console.log(`Usage:
  npm run gmail:sync-replies -- --dry-run
  npm run gmail:sync-replies

Options:
  --dry-run        Sheetsを更新せず、検知結果だけ表示します
  --limit          確認する送信履歴の最大件数。省略時は ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}
  --lookback-days  何日前までの送信履歴を見るか。省略時は GMAIL_LOOKBACK_DAYS または 30
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
    } else if (arg === "--lookback-days") {
      options.lookbackDays = parsePositiveInteger(nextValue(argv, index, "--lookback-days"), "--lookback-days");
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

const readApproachHistory = async (sheets: SheetsClient): Promise<ApproachHistoryRow[]> => {
  const rows = await sheets.getValues(`'${SHEETS.approachHistory}'!A1:J1000`);

  return rows
    .slice(1)
    .map((row, index): ApproachHistoryRow => {
      return {
        rowNumber: index + 2,
        leadId: cell(row, 0),
        sentAt: cell(row, 1),
        method: cell(row, 2),
        recipient: cell(row, 3),
        subject: cell(row, 4),
        sendStatus: cell(row, 7),
        replyStatus: cell(row, 8),
        memo: cell(row, 9)
      };
    })
    .filter((row) => row.leadId);
};

const parseTokyoDate = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");

  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, second));
};

const formatGmailDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}/${month}/${day}`;
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

const normalizeSubject = (subject: string): string => {
  return subject
    .replace(/^\s*(re|fw|fwd)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

const extractMessageId = (memo: string): string => {
  const match = memo.match(/SMTP Message ID:\s*(<[^>]+>)/);
  return match?.[1] ?? "";
};

const hasHeaderMessageId = (message: GmailMessageMetadata, sentMessageId: string): boolean => {
  if (!sentMessageId) {
    return false;
  }

  return message.inReplyTo.includes(sentMessageId) || message.references.includes(sentMessageId);
};

const hasRelatedSubject = (messageSubject: string, sentSubject: string): boolean => {
  const incoming = normalizeSubject(messageSubject);
  const sent = normalizeSubject(sentSubject);

  return Boolean(incoming && sent && (incoming.includes(sent) || sent.includes(incoming)));
};

const isLikelyReply = (
  history: ApproachHistoryRow,
  message: GmailMessageMetadata,
  sentDate: Date | null
): ReplyMatch["matchType"] | null => {
  if (sentDate && message.internalDate && message.internalDate <= sentDate) {
    return null;
  }

  if (hasHeaderMessageId(message, extractMessageId(history.memo))) {
    return "message-id";
  }

  if (hasRelatedSubject(message.subject, history.subject)) {
    return "subject";
  }

  return "from-after-sent";
};

const targetHistories = (
  histories: ApproachHistoryRow[],
  lookbackDays: number,
  limit: number
): ApproachHistoryRow[] => {
  const threshold = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  return histories
    .filter((history) => {
      const sentDate = parseTokyoDate(history.sentAt);

      return (
        history.method === "メール" &&
        history.sendStatus === "送信済み" &&
        history.replyStatus !== "返信あり" &&
        Boolean(history.recipient) &&
        Boolean(sentDate) &&
        (sentDate as Date) >= threshold
      );
    })
    .slice(-limit);
};

const findReplyMatches = async (
  gmail: GmailClient,
  histories: ApproachHistoryRow[],
  gmailUserEmail: string,
  lookbackDays: number
): Promise<ReplyMatch[]> => {
  const matches: ReplyMatch[] = [];

  for (const history of histories) {
    const sentDate = parseTokyoDate(history.sentAt);
    const afterDate = sentDate
      ? new Date(sentDate.getTime() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const query = `from:${history.recipient} to:${gmailUserEmail} after:${formatGmailDate(afterDate)}`;
    const messages = await gmail.searchMessages(query, 10);
    const match = messages
      .map((message) => {
        const matchType = isLikelyReply(history, message, sentDate);
        return matchType ? { history, message, matchType } : null;
      })
      .find((candidate): candidate is ReplyMatch => Boolean(candidate));

    if (match) {
      matches.push(match);
    }
  }

  return matches;
};

const updateReplyStatus = async (
  sheets: SheetsClient,
  match: ReplyMatch
): Promise<void> => {
  const replyDate = match.message.internalDate ? formatTokyoDateTime(match.message.internalDate) : match.message.date;
  const memo = [
    match.history.memo,
    `Gmail返信検知: ${replyDate} / match=${match.matchType} / from=${match.message.from}`
  ]
    .filter(Boolean)
    .join("\n");

  await sheets.updateValues(`'${SHEETS.approachHistory}'!I${match.history.rowNumber}:J${match.history.rowNumber}`, [
    ["返信あり", memo]
  ]);
};

const updateLeadStatuses = async (
  sheets: SheetsClient,
  matches: ReplyMatch[]
): Promise<void> => {
  const table = await readSalesManagementTable(sheets);
  const replyLeadIds = new Set(matches.map((match) => match.history.leadId));

  for (const lead of table.leads) {
    if (replyLeadIds.has(lead.leadId) && lead.status !== "返信あり") {
      await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [["返信あり" as Status]]);
    }
  }
};

const printMatches = (matches: ReplyMatch[]): void => {
  if (matches.length === 0) {
    console.log("No replies detected.");
    return;
  }

  matches.forEach((match, index) => {
    const replyDate = match.message.internalDate ? formatTokyoDateTime(match.message.internalDate) : match.message.date;

    console.log("");
    console.log(`#${index + 1} ${match.history.leadId}`);
    console.log(`History row: ${match.history.rowNumber}`);
    console.log(`Recipient: ${match.history.recipient}`);
    console.log(`Reply date: ${replyDate}`);
    console.log(`From: ${match.message.from}`);
    console.log(`Subject: ${match.message.subject}`);
    console.log(`Match: ${match.matchType}`);
  });
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const gmailConfig = requireGmailConfig(config);
  const sheets = await createSheetsClient(config);
  const histories = await readApproachHistory(sheets);
  const lookbackDays = options.lookbackDays ?? gmailConfig.lookbackDays;
  const targets = targetHistories(histories, lookbackDays, options.limit);

  console.log(`Checking Gmail replies for ${targets.length} sent email histories.`);
  console.log(`Gmail user: ${gmailConfig.userEmail}`);
  console.log(`Lookback days: ${lookbackDays}`);

  const gmail = await createGmailClient({
    clientId: gmailConfig.clientId,
    clientSecret: gmailConfig.clientSecret,
    refreshToken: gmailConfig.refreshToken,
    userEmail: gmailConfig.userEmail
  });
  const matches = await findReplyMatches(gmail, targets, gmailConfig.userEmail, lookbackDays);

  printMatches(matches);

  if (options.dryRun || matches.length === 0) {
    if (options.dryRun) {
      console.log("");
      console.log("Dry run: sheets were not updated.");
    }
    return;
  }

  for (const match of matches) {
    await updateReplyStatus(sheets, match);
  }

  await updateLeadStatuses(sheets, matches);

  console.log("");
  console.log(`Updated replies: ${matches.length}`);
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
