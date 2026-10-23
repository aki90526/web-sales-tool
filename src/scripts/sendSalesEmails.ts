import { loadConfig, requireSmtpConfig } from "../config/env";
import { buildSalesMessage, readSalesContentConfig, SalesContentConfig } from "../contact/salesMessage";
import { SHEETS } from "../domain/lead";
import { readSendRecords } from "../domain/resend";
import { isValidEmail, parseEmailList } from "../email/emailList";
import { acquireSendLock } from "../email/sendLock";
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
  leadIds?: string[];
  testTo?: string[];
  bcc?: string[];
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
  | "メールアドレスが空またはメール形式ではない"
  | "同じ実行内に同じメールアドレスの候補がある";

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 10;

const printHelp = (): void => {
  console.log(`Usage:
  npm run send:emails -- --dry-run --limit 3
  npm run send:emails -- --limit 1
  npm run send:emails -- --lead-id L-0004
  npm run send:emails -- --lead-ids L-0004,L-0005
  npm run send:emails -- --test-to "aki90526@gmail.com" --limit 1
  npm run send:emails -- --test-to "a@example.com,b@example.com" --limit 1
  npm run send:emails -- --limit 1 --bcc "a@example.com,b@example.com"
  npm run send:emails -- --limit 1 --no-bcc

Options:
  --dry-run       送信せず、対象候補だけ表示します
  --limit         送信または表示する最大件数。省略時は ${DEFAULT_LIMIT}、最大 ${MAX_LIMIT}
  --lead-id       指定したリード1件だけを対象にします（送信待ち・メール・形式が正しいアドレスの場合のみ）
  --lead-ids      指定した複数のリード（カンマ区切り）だけを対象にします。条件は --lead-id と同じ
  --test-to       実際の営業メール本文を指定アドレスへテスト送信します（カンマ区切りで複数可）。Sheets は更新せず、BCCも付けません
  --bcc           本送信のBCCを指定アドレスに変更します（カンマ区切りで複数可）。省略時は SMTP_BCC
  --no-bcc        本送信でBCCを付けません
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
    } else if (arg === "--lead-id" || arg === "--lead-ids") {
      const ids = nextValue(argv, index, arg).split(",").map((id) => id.trim()).filter(Boolean);
      options.leadIds = Array.from(new Set([...(options.leadIds ?? []), ...ids]));
      index += 1;
    } else if (arg === "--test-to") {
      options.testTo = parseEmailList(nextValue(argv, index, "--test-to"));
      index += 1;
    } else if (arg === "--bcc") {
      options.bcc = parseEmailList(nextValue(argv, index, "--bcc"));
      index += 1;
    } else if (arg === "--no-bcc") {
      options.bcc = [];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.limit > MAX_LIMIT) {
    throw new Error(`--limit must be ${MAX_LIMIT} or less`);
  }

  if (options.leadIds && options.leadIds.length > MAX_LIMIT) {
    throw new Error(`--lead-ids must be ${MAX_LIMIT} or less`);
  }

  if (options.testTo && options.testTo.length === 0) {
    throw new Error("--test-to must include at least one email address");
  }

  if (options.bcc && options.bcc.length > 0 && options.testTo) {
    throw new Error("--bcc cannot be used with --test-to");
  }

  if (options.dryRun && options.testTo) {
    throw new Error("--dry-run and --test-to cannot be used together");
  }

  return options;
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
  salesAngle: string,
  previousSentAt: string
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
      salesMessageDraft: "",
      channel: "メール",
      previousSentAt: previousSentAt || undefined
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
  contentConfig: SalesContentConfig,
  leadIds?: string[]
): Promise<{ candidates: SalesEmailCandidate[]; skipped: Map<SkipReason, number> }> => {
  const table = await readSalesManagementTable(sheets);
  const salesContexts = await readAnalysisSalesContexts(sheets);
  const sendRecords = await readSendRecords(sheets);
  const skipped = new Map<SkipReason, number>();
  const candidates: SalesEmailCandidate[] = [];
  const queuedAddresses = new Set<string>();

  table.leads.forEach((lead) => {
    if (candidates.length >= limit) {
      return;
    }

    if (leadIds && leadIds.length > 0 && !leadIds.includes(lead.leadId)) {
      return;
    }

    const result = toCandidate(
      lead,
      contentConfig,
      salesContexts.get(lead.leadId)?.recommendedApproach ?? "",
      salesContexts.get(lead.leadId)?.salesAngle ?? "",
      sendRecords.get(lead.leadId)?.lastSentAt ?? ""
    );

    if (result.candidate) {
      const address = result.candidate.emailAddress.trim().toLowerCase();

      if (queuedAddresses.has(address)) {
        skipped.set("同じ実行内に同じメールアドレスの候補がある", (skipped.get("同じ実行内に同じメールアドレスの候補がある") ?? 0) + 1);
        return;
      }

      queuedAddresses.add(address);
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

const setLeadStatus = async (sheets: SheetsClient, rowNumber: number, status: string): Promise<void> => {
  const table = await readSalesManagementTable(sheets);
  await sheets.updateValues(statusRangeForRow(table.columns, rowNumber), [[status]]);
};

// 送信直前に最新のシートを読み直し、まだ「送信待ち」の同じリードか確認する（別プロセスが先に送った場合の二重送信防止）
const isStillWaitingToSend = async (sheets: SheetsClient, candidate: SalesEmailCandidate): Promise<boolean> => {
  const table = await readSalesManagementTable(sheets);
  const current = table.leads.find((lead) => lead.rowNumber === candidate.rowNumber);

  return (
    current !== undefined &&
    current.leadId === candidate.leadId &&
    current.status === "送信待ち" &&
    current.emailAddress.trim().toLowerCase() === candidate.emailAddress.trim().toLowerCase()
  );
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
  const { candidates, skipped } = await findCandidates(sheets, options.leadIds && options.leadIds.length > 0 ? options.leadIds.length : options.limit, contentConfig, options.leadIds);

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
        `Sending test copy for ${candidate.leadId} ${candidate.companyName} to ${options.testTo.join(", ")} (original: ${candidate.emailAddress})...`
      );
      const result = await mailer.send({
        to: options.testTo,
        bcc: [],
        subject: `[テスト] ${candidate.subject}`,
        text: candidate.body
      });

      console.log(`Sent test copy for ${candidate.leadId}. Message ID: ${result.messageId}`);
    }

    console.log("Test mode: sheets were not updated.");
    console.log(`[DASHBOARD_SUMMARY] count=${candidates.length} mode=test`);
    return;
  }

  const releaseLock = await acquireSendLock();
  let sentCount = 0;

  try {
    for (const candidate of candidates) {
      if (!(await isStillWaitingToSend(sheets, candidate))) {
        console.log(`Skipped ${candidate.leadId} ${candidate.companyName}: 送信直前の確認でステータスが送信待ちではなくなっていました（二重送信防止）。`);
        continue;
      }

      console.log(`Sending ${candidate.leadId} ${candidate.companyName} to ${candidate.emailAddress}...`);

      // 先に「送信済み」にしてから送る。途中で落ちても再実行で同じ相手に再送されない（送れていない場合は目視で確認できる）
      await setLeadStatus(sheets, candidate.rowNumber, "送信済み");

      let messageId: string;
      try {
        const result = await mailer.send({
          to: candidate.emailAddress,
          bcc: options.bcc,
          subject: candidate.subject,
          text: candidate.body
        });
        messageId = result.messageId;
      } catch (error) {
        // SMTP が明確に失敗した場合のみ送信待ちへ戻す
        await setLeadStatus(sheets, candidate.rowNumber, "送信待ち");
        throw error;
      }

      sentCount += 1;
      const sentAt = formatTokyoDateTime(new Date());

      try {
        await appendApproachHistory(sheets, candidate, messageId, sentAt);
      } catch (error) {
        console.error(
          `WARNING: ${candidate.leadId} は送信済みですが、アプローチ履歴への記録に失敗しました。手動で追記してください。Message ID: ${messageId}`
        );
        throw error;
      }

      console.log(`Sent ${candidate.leadId}. Message ID: ${messageId}`);
    }
  } finally {
    await releaseLock();
  }

  console.log(`[DASHBOARD_SUMMARY] count=${sentCount} mode=send`);
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
