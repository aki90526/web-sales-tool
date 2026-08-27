import { loadConfig } from "../config/env";
import { buildSalesBody, buildSalesSubject } from "../contact/salesMessage";
import { SHEETS, Status } from "../domain/lead";
import { createSheetsClient, SheetsClient } from "../google/sheetsClient";

type CliOptions = {
  dryRun: boolean;
  force: boolean;
  help: boolean;
  leadId: string;
  note: string;
};

type FormLead = {
  rowNumber: number;
  leadId: string;
  companyName: string;
  leadType: string;
  contactMethod: string;
  formUrl: string;
  recommendedApproach: string;
  salesMessageDraft: string;
  status: string;
  nextActionDate: string;
};

const COL = {
  leadId: 0,
  companyName: 1,
  leadType: 2,
  contactMethod: 6,
  formUrl: 7,
  recommendedApproach: 11,
  salesMessageDraft: 12,
  status: 13,
  nextActionDate: 15
} as const;

const printHelp = (): void => {
  console.log(`Usage:
  npm run forms:mark-sent -- --lead-id L-0004
  npm run forms:mark-sent -- --lead-id L-0004 --dry-run
  npm run forms:mark-sent -- --lead-id L-0004 --note "フォーム送信済み"

Options:
  --lead-id    送信済みにするリードID
  --dry-run    Sheetsを更新せず、記録内容だけ表示します
  --note       アプローチ履歴のメモ
  --force      ステータスや次回対応日の警告を無視して記録します
`);
};

const nextValue = (args: string[], index: number, name: string): string => {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    dryRun: false,
    force: false,
    help: false,
    leadId: "",
    note: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--lead-id") {
      options.leadId = nextValue(argv, index, "--lead-id");
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--note") {
      options.note = nextValue(argv, index, "--note");
      index += 1;
    } else if (arg === "--force") {
      options.force = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.help && !options.leadId) {
    throw new Error("--lead-id is required");
  }

  return options;
};

const cell = (row: unknown[], index: number): string => {
  const value = row[index];
  return value === undefined || value === null ? "" : String(value).trim();
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

const readLead = async (sheets: SheetsClient, leadId: string): Promise<FormLead | null> => {
  const rows = await sheets.getValues(`'${SHEETS.salesManagement}'!A2:Q1000`);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    if (cell(row, COL.leadId) !== leadId) {
      continue;
    }

    return {
      rowNumber: index + 2,
      leadId,
      companyName: cell(row, COL.companyName),
      leadType: cell(row, COL.leadType),
      contactMethod: cell(row, COL.contactMethod),
      formUrl: cell(row, COL.formUrl),
      recommendedApproach: cell(row, COL.recommendedApproach),
      salesMessageDraft: cell(row, COL.salesMessageDraft),
      status: cell(row, COL.status),
      nextActionDate: cell(row, COL.nextActionDate)
    };
  }

  return null;
};

const validateLead = (lead: FormLead, force: boolean): void => {
  if (!isValidUrl(lead.formUrl)) {
    throw new Error(`${lead.leadId} has no valid form URL`);
  }

  if (lead.contactMethod !== "問い合わせフォーム" && !force) {
    throw new Error(`${lead.leadId} is not marked as 問い合わせフォーム. Use --force to override.`);
  }

  if (lead.status !== "送信待ち" && !force) {
    throw new Error(`${lead.leadId} status is ${lead.status || "(blank)"}. Use --force to override.`);
  }

  if (isFutureDate(lead.nextActionDate) && !force) {
    throw new Error(`${lead.leadId} next action date is ${lead.nextActionDate}. Use --force to override.`);
  }

  if (!lead.salesMessageDraft) {
    throw new Error(`${lead.leadId} has no sales message draft`);
  }
};

const appendApproachHistory = async (
  sheets: SheetsClient,
  lead: FormLead,
  subject: string,
  body: string,
  note: string,
  sentAt: string
): Promise<void> => {
  await sheets.appendValues(`'${SHEETS.approachHistory}'!A:J`, [
    [
      lead.leadId,
      sentAt,
      "問い合わせフォーム",
      lead.formUrl,
      subject,
      body,
      "承認",
      "送信済み",
      "未返信",
      note || "forms:mark-sent による手動フォーム送信記録"
    ]
  ]);
};

const updateLeadStatus = async (sheets: SheetsClient, rowNumber: number, status: Status): Promise<void> => {
  await sheets.updateValues(`'${SHEETS.salesManagement}'!N${rowNumber}:N${rowNumber}`, [[status]]);
};

const printRecord = (lead: FormLead, subject: string, body: string, sentAt: string, note: string): void => {
  console.log(`${lead.leadId} ${lead.companyName}`);
  console.log(`Row: ${lead.rowNumber}`);
  console.log(`Sent at: ${sentAt}`);
  console.log(`Method: 問い合わせフォーム`);
  console.log(`Form URL: ${lead.formUrl}`);
  console.log(`Subject: ${subject}`);
  console.log("Message:");
  console.log(body);
  console.log(`Note: ${note || "forms:mark-sent による手動フォーム送信記録"}`);
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const sheets = await createSheetsClient(config);
  const lead = await readLead(sheets, options.leadId);

  if (!lead) {
    throw new Error(`Lead not found: ${options.leadId}`);
  }

  validateLead(lead, options.force);

  const subject = buildSalesSubject(lead.leadType, lead.recommendedApproach);
  const body = buildSalesBody(lead.salesMessageDraft);
  const sentAt = formatTokyoDateTime(new Date());

  if (options.dryRun) {
    console.log("Dry run: sheets will not be updated.");
    printRecord(lead, subject, body, sentAt, options.note);
    return;
  }

  await appendApproachHistory(sheets, lead, subject, body, options.note, sentAt);
  await updateLeadStatus(sheets, lead.rowNumber, "送信済み");

  console.log(`Marked form submission as sent: ${lead.leadId}`);
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
