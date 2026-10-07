import { loadConfig, requireSmtpConfig } from "../config/env";
import { buildSalesMessage, readSalesContentConfig, SalesContentConfig } from "../contact/salesMessage";
import { SHEETS } from "../domain/lead";
import { createSmtpMailer } from "../email/smtpMailer";
import { readAnalysisSalesContexts } from "../google/analysisDataRepository";
import {
  readSalesManagementTable,
  SalesManagementLead,
  statusRangeForRow
} from "../google/salesManagementRepository";
import { createSheetsClient, SheetsClient } from "../google/sheetsClient";

type CliOptions = {
  dryRun: boolean;
  help: boolean;
  limit: number;
  testTo?: string;
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
  subject: string;
  body: string;
  autoInsertPreview: string;
  templateId: string;
};

type SkipReason =
  | "ステータスが送信待ちではない"
  | "次回対応日が未来"
  | "連絡方法がメールではない"
  | "メールアドレスが空またはメール形式ではない";

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 10;

const printHelp = (): void => {
  console.log(`Usage:
  npm run send:emails -- --dry-run --limit 3
  npm run send:emails -- --limit 1
  npm run send:emails -- --test-to "aki90526@gmail.com" --limit 1

Options:
  --dry-run       送信せず、対象候補だけ表示します
  --limit         送信または表示する最大件数。省略時は ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}
  --test-to       実際の営業メール本文を指定アドレスへテスト送信します。Sheets は更新しません
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
    } else if (arg === "--test-to") {
      options.testTo = nextValue(argv, index, "--test-to");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.limit > MAX_LIMIT) {
    throw new Error(`--limit must be ${MAX_LIMIT} or less`);
  }

  if (options.testTo && !isValidEmail(options.testTo)) {
    throw new Error("--test-to must be a valid email address");
  }

  if (options.dryRun && options.testTo) {
    throw new Error("--dry-run and --test-to cannot be used together");
  }

  return options;
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

const toCandidate = (
  lead: SalesManagementLead,
  contentConfig: SalesContentConfig,
  recommendedApproach: string,
  salesAngle: string
): { candidate?: SalesEmailCandidate; reason?: SkipReason } => {
  if (lead.status !== "送信待ち") {
    return { reason: "ステータスが送信待ちではない" };
  }

  if (isFutureDate(lead.nextActionDate)) {
    return { reason: "次回対応日が未来" };
  }

  if (lead.contactMethod !== "メール") {
    return { reason: "連絡方法がメールではない" };
  }

  if (!isValidEmail(lead.emailAddress)) {
    return { reason: "メールアドレスが空またはメール形式ではない" };
  }

  const message = buildSalesMessage(
    {
      companyName: lead.companyName,
      leadType: lead.leadType,
      industry: lead.industry,
      region: lead.region,
      officialSiteUrl: lead.officialSiteUrl,
      salesAngle,
      recommendedApproach,
      salesMessageDraft: ""
    },
    contentConfig
  );

  return {
    candidate: {
      rowNumber: lead.rowNumber,
      leadId: lead.leadId,
      companyName: lead.companyName,
      leadType: lead.leadType,
      industry: lead.industry,
      region: lead.region,
      officialSiteUrl: lead.officialSiteUrl,
      contactMethod: lead.contactMethod,
      emailAddress: lead.emailAddress,
      salesScore: lead.salesScore,
      salesAngle,
      subject: message.subject,
      body: message.body,
      autoInsertPreview: message.autoInsertPreview,
      templateId: message.templateId
    }
  };
};

const findCandidates = async (
  sheets: SheetsClient,
  limit: number,
  contentConfig: SalesContentConfig
): Promise<{ candidates: SalesEmailCandidate[]; skipped: Map<SkipReason, number> }> => {
  const table = await readSalesManagementTable(sheets);
  const salesContexts = await readAnalysisSalesContexts(sheets);
  const skipped = new Map<SkipReason, number>();
  const candidates: SalesEmailCandidate[] = [];

  table.leads.forEach((lead) => {
    if (candidates.length >= limit) {
      return;
    }

    const result = toCandidate(
      lead,
      contentConfig,
      salesContexts.get(lead.leadId)?.recommendedApproach ?? "",
      salesContexts.get(lead.leadId)?.salesAngle ?? ""
    );

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

const printCandidates = (candidates: SalesEmailCandidate[]): void => {
  console.log(`Eligible email leads: ${candidates.length}`);

  candidates.forEach((candidate, index) => {
    console.log("");
    console.log(`#${index + 1} ${candidate.leadId} ${candidate.companyName}`);
    console.log(`Row: ${candidate.rowNumber}`);
    console.log(`To: ${candidate.emailAddress}`);
    console.log(`Score: ${candidate.salesScore}`);
    console.log(`Template: ${candidate.templateId}`);
    console.log(`Subject: ${candidate.subject}`);
    console.log("Auto insert preview:");
    console.log(candidate.autoInsertPreview);
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
  const table = await readSalesManagementTable(sheets);
  await sheets.updateValues(statusRangeForRow(table.columns, rowNumber), [["送信済み"]]);
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
  const { candidates, skipped } = await findCandidates(sheets, options.limit, contentConfig);

  if (options.dryRun) {
    console.log("Dry run: no emails will be sent and sheets will not be updated.");
    printCandidates(candidates);
    printSkippedSummary(skipped);
    console.log(`[DASHBOARD_SUMMARY] count=${candidates.length} mode=dry-run`);
    return;
  }

  if (candidates.length === 0) {
    console.log("No eligible email leads found. Nothing was sent.");
    printSkippedSummary(skipped);
    console.log(`[DASHBOARD_SUMMARY] count=0 mode=${options.testTo ? "test" : "send"}`);
    return;
  }

  const smtpConfig = requireSmtpConfig(config);
  const mailer = createSmtpMailer(smtpConfig);

  console.log(`Verifying SMTP connection for ${smtpConfig.user}...`);
  await mailer.verify();

  if (options.testTo) {
    for (const candidate of candidates) {
      console.log(
        `Sending test copy for ${candidate.leadId} ${candidate.companyName} to ${options.testTo} (original: ${candidate.emailAddress})...`
      );
      const result = await mailer.send({
        to: options.testTo,
        subject: `[テスト] ${candidate.subject}`,
        text: candidate.body
      });

      console.log(`Sent test copy for ${candidate.leadId}. Message ID: ${result.messageId}`);
    }

    console.log("Test mode: sheets were not updated.");
    console.log(`[DASHBOARD_SUMMARY] count=${candidates.length} mode=test`);
    return;
  }

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

  console.log(`[DASHBOARD_SUMMARY] count=${candidates.length} mode=send`);
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
