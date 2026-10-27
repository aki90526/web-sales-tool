import { loadConfig, requireGmailConfig, requireSmtpConfig } from "../config/env";
import { SHEETS, Status } from "../domain/lead";
import { matchBookingToLeads, parseBookingNotification } from "../google/bookingNotifications";
import {
  columnLetter,
  fieldRangeForRow,
  readSalesManagementTable,
  SalesManagementLead,
  statusRangeForRow
} from "../google/salesManagementRepository";
import { isBounceSubject, parseBounce } from "../email/bounceDetection";
import { detectOptOut } from "../email/optOutDetection";
import { recheckRejectedLeads } from "../collection/rejectedRecheck";
import { appendLeadLog } from "../domain/leadLog";
import { todayInTokyo } from "../domain/resend";
import { revertDueResends } from "../domain/resendRevert";
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
  matchType: "message-id" | "subject" | "from-after-sent" | "form-domain-after-sent";
  optOut?: string;
};

const DEFAULT_LIMIT = 200;
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
  const rows = await sheets.getValues(`'${SHEETS.approachHistory}'!A:J`);

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

// 自動返信・配信エラー・受付完了通知などは、人からの返信ではないため除く
const isAutomatedMessage = (message: GmailMessageMetadata): boolean => {
  const isReplySubject = /^\s*(re|fw|fwd|返信)\s*[:：]/i.test(message.subject);

  return (
    /(no-?reply|do-?not-?reply|mailer-daemon|postmaster)/i.test(message.from) ||
    /(自動返信|自動送信|【自動】|受付完了|受付番号|受け付けました|受付しました|確認メール|auto[- ]?reply|do not reply|delivery status|undeliverable)/i.test(
      message.subject
    ) ||
    // 「お問い合わせありがとうございます」「ご応募ありがとうございます」など、返信（Re:）ではない受付の自動メール
    (/ありがとう/.test(message.subject) && !isReplySubject)
  );
};

// フォーム送信直後に届くメールは、件名に目印がなくても受付の自動送信とみなす
const FORM_AUTO_REPLY_WINDOW_MS = 10 * 60 * 1000;

// 「以下の内容を受付けました」など、送信内容を控えとして返す受付メールの本文
const isFormReceiptBody = (text: string): boolean => {
  return /(以下の内容[をで]?.{0,10}(受け?付け?|承り|送信)|受け?付け?(いた)?しました|自動(返信|送信|配信)(され|して|い?た?し)?)/.test(
    text
  );
};

const isFormAutoReply = async (
  gmail: GmailClient,
  message: GmailMessageMetadata,
  sentDate: Date | null
): Promise<boolean> => {
  if (isAutomatedMessage(message)) {
    return true;
  }

  if (sentDate && message.internalDate && message.internalDate.getTime() - sentDate.getTime() <= FORM_AUTO_REPLY_WINDOW_MS) {
    return true;
  }

  return isFormReceiptBody(await gmail.getMessageText(message.id));
};

const siteDomain = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
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
        (history.method === "メール" || history.method === "フォーム") &&
        history.sendStatus === "送信済み" &&
        history.replyStatus !== "返信あり" &&
        // 「別の窓口から再送してください」という案内だけの返信は、反応として数えず、再検知の対象にもしない
        history.replyStatus !== "再送案内" &&
        history.replyStatus !== "不達" &&
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
  replyToAddress: string,
  lookbackDays: number,
  leadDomains: Map<string, string>
): Promise<ReplyMatch[]> => {
  const matches: ReplyMatch[] = [];

  for (const history of histories) {
    const sentDate = parseTokyoDate(history.sentAt);
    const afterDate = sentDate
      ? new Date(sentDate.getTime() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const isForm = history.method === "フォーム";
    const domain = isForm ? leadDomains.get(history.leadId) ?? "" : "";

    // フォーム送信は宛先のメールアドレスが分からないため、リードのサイトと同じドメインからの返信を探す
    if (isForm && !domain) {
      continue;
    }

    // 迷惑メールのフォルダに振り分けられた返信も見つけるため、迷惑メールを含めて探す（ゴミ箱は除く）
    const scope = "in:anywhere -in:trash";
    const query = isForm
      ? `${scope} from:${domain} to:${replyToAddress} after:${formatGmailDate(afterDate)}`
      : `${scope} from:${history.recipient} to:${replyToAddress} after:${formatGmailDate(afterDate)}`;
    const messages = await gmail.searchMessages(query, 10);

    if (isForm) {
      for (const message of messages) {
        if (!message.internalDate || (sentDate && message.internalDate <= sentDate)) {
          continue;
        }

        if (await isFormAutoReply(gmail, message, sentDate)) {
          continue;
        }

        matches.push({ history, message, matchType: "form-domain-after-sent" });
        break;
      }

      continue;
    }

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
    `Gmail返信検知: ${replyDate} / match=${match.matchType} / from=${match.message.from}`,
    match.optOut ? `配信停止・営業お断りの返信を検知: 「${match.optOut}」` : ""
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
  const optOuts = new Map(matches.filter((match) => match.optOut).map((match) => [match.history.leadId, match.optOut as string]));
  const replyLeadIds = new Set(matches.map((match) => match.history.leadId));

  for (const lead of table.leads) {
    if (!replyLeadIds.has(lead.leadId)) {
      continue;
    }

    const optOut = optOuts.get(lead.leadId);

    if (optOut) {
      // 配信停止・営業お断りの返信は「除外」にして、以後の送信・フォーム入力の対象から外す
      const line = `配信停止・営業お断りの返信を検知: 「${optOut}」`;

      if (lead.status !== "除外") {
        await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [["除外" as Status]]);
      }

      await appendLeadLog(sheets, [
        { leadId: lead.leadId, kind: "返信・検知", text: line },
        ...(lead.status !== "除外" ? [{ leadId: lead.leadId, kind: "ステータス変更", text: `${lead.status} → 除外（配信停止・営業お断りの返信）` }] : [])
      ]);
    } else if (lead.status !== "返信あり") {
      await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [["返信あり" as Status]]);
      await appendLeadLog(sheets, [
        { leadId: lead.leadId, kind: "返信・検知", text: "返信を検知しました" },
        { leadId: lead.leadId, kind: "ステータス変更", text: `${lead.status} → 返信あり（返信の検知）` }
      ]);
    }
  }
};

type BookingSync = {
  lead: SalesManagementLead;
  when: string;
  line: string;
};

// 予約システムの通知メール（aawebcreate@gmail.com から転送されたもの）を読み取り、該当リードを「返信あり」にして、メモに面談日時を残す
const syncBookingNotifications = async (
  gmail: GmailClient,
  sheets: SheetsClient,
  histories: ApproachHistoryRow[],
  dryRun: boolean
): Promise<BookingSync[]> => {
  const messages = await gmail.searchMessages('in:anywhere -in:trash "新しい面談の予約が入りました" newer_than:90d', 20);
  const table = await readSalesManagementTable(sheets);
  const applied: BookingSync[] = [];
  const reflectedStatuses = ["未確認", "確認済み", "送信待ち", "送信済み"];

  for (const message of messages) {
    const booking = parseBookingNotification(await gmail.getMessageText(message.id));

    if (!booking) {
      continue;
    }

    const candidates = matchBookingToLeads(booking, table.leads);
    const lead = candidates.find((entry) => entry.status === "送信済み") ?? candidates[0];

    if (!lead) {
      console.log(`Booking (${booking.company} / ${booking.email} / ${booking.when}): 該当するリードが見つかりません`);
      continue;
    }

    if (lead.memo.includes(`面談予約: ${booking.when}`)) {
      continue;
    }

    const line = `面談予約: ${booking.when} / ${booking.name}${booking.meetUrl ? ` / Meet: ${booking.meetUrl}` : ""}`;

    console.log("");
    console.log(`Booking: ${lead.leadId} ${lead.companyName} (${lead.status})`);
    console.log(`  ${line}`);
    console.log(`[DASHBOARD_UPDATE] leadId=${lead.leadId} company=${lead.companyName} type=booking detail=${line}`);

    if (!dryRun) {
      if (reflectedStatuses.includes(lead.status)) {
        await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [["返信あり" as Status]]);
      }

      await sheets.updateValues(fieldRangeForRow(table.columns, "memo", lead.rowNumber), [[lead.memo ? `${lead.memo}\n${line}` : line]]);
      await appendLeadLog(sheets, [{ leadId: lead.leadId, kind: "返信・検知", text: `面談予約を検知: ${line}` }]);

      for (const history of histories.filter((row) => row.leadId === lead.leadId && row.sendStatus === "送信済み" && row.replyStatus !== "返信あり")) {
        await sheets.updateValues(`'${SHEETS.approachHistory}'!I${history.rowNumber}:J${history.rowNumber}`, [
          ["返信あり", [history.memo, `面談予約を検知: ${booking.when}`].filter(Boolean).join("\n")]
        ]);
      }

      // 同じ実行内で、同じリードの別の予約通知を重複して追記しないよう、メモを更新しておく
      lead.memo = lead.memo ? `${lead.memo}\n${line}` : line;
    }

    applied.push({ lead, when: booking.when, line });
  }

  return applied;
};

type BounceSync = {
  lead: SalesManagementLead;
  recipient: string;
  detail: string;
  next: string;
};

// 不達通知（宛先が存在しない・受信拒否など、永続的なエラーのみ）を読み取り、該当するメール送信を「不達」として記録する。
// 迷惑メール扱い（[SPAM]）で届くことがあるため、迷惑メールのフォルダも含めて探す
const syncBounces = async (
  gmail: GmailClient,
  sheets: SheetsClient,
  histories: ApproachHistoryRow[],
  lookbackDays: number,
  dryRun: boolean
): Promise<BounceSync[]> => {
  const messages = await gmail.searchMessages(
    `in:anywhere (from:mailer-daemon OR from:postmaster OR subject:"Undelivered Mail" OR subject:"Delivery Status Notification" OR subject:"Mail Delivery") newer_than:${Math.max(1, lookbackDays)}d`,
    50
  );
  const table = await readSalesManagementTable(sheets);
  const applied: BounceSync[] = [];
  const handledRows = new Set<number>();

  for (const message of messages) {
    if (!isBounceSubject(message.subject) && !/(mailer-daemon|postmaster)/i.test(message.from)) {
      continue;
    }

    const bounce = parseBounce(await gmail.getMessageText(message.id));

    if (!bounce || !bounce.permanent) {
      continue;
    }

    // この宛先へ、不達通知より前に送ったメールのうち、いちばん新しいものを対象にする
    const history = histories
      .filter((row) => {
        const sentDate = parseTokyoDate(row.sentAt);

        return (
          row.method === "メール" &&
          row.sendStatus === "送信済み" &&
          row.recipient.trim().toLowerCase() === bounce.recipient &&
          !["不達", "返信あり"].includes(row.replyStatus) &&
          !handledRows.has(row.rowNumber) &&
          (!sentDate || !message.internalDate || sentDate <= message.internalDate)
        );
      })
      .sort((a, b) => b.rowNumber - a.rowNumber)[0];

    if (!history) {
      continue;
    }

    const lead = table.leads.find((entry) => entry.leadId === history.leadId);

    if (!lead) {
      continue;
    }

    handledRows.add(history.rowNumber);

    const when = message.internalDate ? formatTokyoDateTime(message.internalDate) : message.date;
    const reasonText = `メール不達: ${bounce.recipient} ${bounce.status} ${bounce.reason} (${when})`.replace(/\s+/g, " ");
    const hasForm = /^https?:\/\//i.test(lead.contactFormUrl);
    // 送信済みのままのリードだけ、次の手段へ進める（返信などで状況が進んでいるものは変えない）
    const moveOn = lead.status === "送信済み";
    const next = !moveOn ? lead.status : hasForm ? "送信待ち（フォームへ切り替え）" : "見送り";
    const actionLine = !moveOn
      ? ""
      : hasForm
      ? "→ フォームURLがあるため、連絡方法をフォームに切り替えて送信待ちに戻しました"
      : "→ 他の連絡手段がないため、見送りにしました";

    console.log("");
    console.log(`Bounce: ${lead.leadId} ${lead.companyName} (${lead.status})`);
    console.log(`  ${reasonText}`);
    console.log(`  next: ${next}`);
    console.log(
      `[DASHBOARD_UPDATE] leadId=${lead.leadId} company=${lead.companyName} type=bounce detail=${bounce.recipient} ${bounce.status} ${bounce.reason} → ${next}`
    );

    if (!dryRun) {
      let skipLine = "";

      await sheets.updateValues(`'${SHEETS.approachHistory}'!I${history.rowNumber}:J${history.rowNumber}`, [
        ["不達", [history.memo, reasonText].filter(Boolean).join("\n")]
      ]);

      if (moveOn) {
        if (hasForm) {
          await sheets.updateValues(fieldRangeForRow(table.columns, "contactMethod", lead.rowNumber), [["フォーム"]]);
          await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [["送信待ち" as Status]]);
        } else {
          await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [["見送り" as Status]]);
          // 見送りの再確認の起点になる、見送りにした日の記録
          skipLine = `ステータス変更: ${lead.status || "(空)"} → 見送り (${todayInTokyo()})`;
        }
      }

      // 不達の内容と、その後の対応は、メモではなく、リードログに残す
      await appendLeadLog(sheets, [
        { leadId: lead.leadId, kind: "返信・検知", text: `メール不達を検知: ${reasonText}` },
        ...(actionLine ? [{ leadId: lead.leadId, kind: "連絡先", text: actionLine }] : []),
        ...(skipLine ? [{ leadId: lead.leadId, kind: "ステータス変更", text: `${lead.status || "(空)"} → 見送り（メール不達）` }] : [])
      ]);
    }

    applied.push({ lead, recipient: bounce.recipient, detail: reasonText, next });
  }

  return applied;
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

    if (match.optOut) {
      console.log(`Opt-out detected: ${match.optOut}`);
    }
  });
};

const syncReplies = async (options: CliOptions): Promise<void> => {

  const config = loadConfig();
  const gmailConfig = requireGmailConfig(config);
  const smtpConfig = requireSmtpConfig(config);
  const sheets = await createSheetsClient(config);
  const histories = await readApproachHistory(sheets);
  const lookbackDays = options.lookbackDays ?? gmailConfig.lookbackDays;
  const targets = targetHistories(histories, lookbackDays, options.limit);
  const replyToAddress = smtpConfig.user;

  console.log(`Checking Gmail replies for ${targets.length} sent email histories.`);
  console.log(`Gmail user: ${gmailConfig.userEmail}`);
  console.log(`Reply-to address: ${replyToAddress}`);
  console.log(`Lookback days: ${lookbackDays}`);

  const gmail = await createGmailClient({
    clientId: gmailConfig.clientId,
    clientSecret: gmailConfig.clientSecret,
    refreshToken: gmailConfig.refreshToken,
    userEmail: gmailConfig.userEmail
  });
  const table = await readSalesManagementTable(sheets);
  const leadDomains = new Map(table.leads.map((lead) => [lead.leadId, siteDomain(lead.officialSiteUrl)]));
  const matches = await findReplyMatches(gmail, targets, replyToAddress, lookbackDays, leadDomains);

  for (const match of matches) {
    const optOut = detectOptOut(await gmail.getMessageText(match.message.id));

    if (optOut) {
      match.optOut = optOut;
    }
  }

  printMatches(matches);

  const bookings = await syncBookingNotifications(gmail, sheets, histories, options.dryRun);
  const bounces = await syncBounces(gmail, sheets, histories, lookbackDays, options.dryRun);
  const totalCount = matches.length + bookings.length + bounces.length;

  if (options.dryRun || matches.length === 0) {
    if (options.dryRun) {
      console.log("");
      console.log("Dry run: sheets were not updated.");
    }
    console.log(`[DASHBOARD_SUMMARY] count=${totalCount} mode=${options.dryRun ? "dry-run" : "sync"}`);
    return;
  }

  for (const match of matches) {
    await updateReplyStatus(sheets, match);

    const company = table.leads.find((lead) => lead.leadId === match.history.leadId)?.companyName ?? "";
    console.log(
      `[DASHBOARD_UPDATE] leadId=${match.history.leadId} company=${company} type=${match.optOut ? "optout" : "reply"} detail=${match.optOut ? `「${match.optOut}」 / ` : ""}${match.message.from} / ${match.message.subject}`
    );
  }

  await updateLeadStatuses(sheets, matches);

  console.log("");
  console.log(`Updated replies: ${matches.length}`);
  console.log(`[DASHBOARD_SUMMARY] count=${totalCount} mode=sync`);
};

// 返信の反映のあとに、再送の期日を過ぎた「送信済み」を「送信待ち」に戻す（送信そのものは行わない）
const revertDueLeads = async (dryRun: boolean): Promise<void> => {
  const sheets = await createSheetsClient(loadConfig());
  const reverted = await revertDueResends(sheets, { dryRun });

  console.log("");
  console.log(`Resend due leads${dryRun ? " (dry-run)" : ""}: ${reverted.length}`);

  for (const entry of reverted) {
    console.log(
      `[DASHBOARD_UPDATE] leadId=${entry.leadId} company=${entry.companyName} type=resend-due detail=前回送信${entry.lastSentAt}から${entry.elapsedDays}日経過（${entry.sentCount}回送信済み）→ 送信待ち`
    );
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  await syncReplies(options);
  await revertDueLeads(options.dryRun);

  // 見送りの再確認は、サイトへのアクセスが多いため1回15件まで。失敗しても返信同期の結果には影響させない
  try {
    const sheets = await createSheetsClient(loadConfig());
    const results = await recheckRejectedLeads(sheets, { dryRun: options.dryRun, limit: 15 });
    const revived = results.filter((result) => result.outcome === "revived");

    console.log(`Rejected lead recheck${options.dryRun ? " (dry-run)" : ""}: ${results.length} checked, ${revived.length} revived`);

    for (const result of revived) {
      console.log(
        `[DASHBOARD_UPDATE] leadId=${result.leadId} company=${result.companyName} type=recheck-revived detail=${result.detail}`
      );
    }
  } catch (error: unknown) {
    console.error(`Rejected lead recheck failed: ${error instanceof Error ? error.message : error}`);
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
