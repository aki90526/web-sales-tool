import { execFile } from "child_process";
import { loadConfig } from "../config/env";
import {
  buildSalesMessage,
  readSalesContentConfig,
  SalesContentConfig,
  SenderInfo
} from "../contact/salesMessage";
import { SHEETS } from "../domain/lead";
import { scoreThresholdForLeadType } from "../domain/scoring";
import { readAnalysisSalesContexts } from "../google/analysisDataRepository";
import {
  readSalesManagementTable,
  SalesManagementLead
} from "../google/salesManagementRepository";
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
  industry: string;
  region: string;
  officialSiteUrl: string;
  formUrl: string;
  salesScore: number;
  salesAngle: string;
  subject: string;
  body: string;
  templateId: string;
};

type SkipReason =
  | "ステータスが送信待ちではない"
  | "次回対応日が未来"
  | "連絡方法が問い合わせフォームではない"
  | "フォームURLが空またはURL形式ではない"
  | "営業スコアが基準未満";

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;
const DEFAULT_MIN_SCORE = 50;

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

const scoreThresholdForCandidate = (leadType: string, configuredMinScore: number): number => {
  return Math.min(configuredMinScore, scoreThresholdForLeadType(leadType));
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
  lead: SalesManagementLead,
  minScore: number,
  contentConfig: SalesContentConfig,
  recommendedApproach: string,
  salesAngle: string
): { candidate?: FormCandidate; reason?: SkipReason } => {
  if (lead.status !== "送信待ち") {
    return { reason: "ステータスが送信待ちではない" };
  }

  if (isFutureDate(lead.nextActionDate)) {
    return { reason: "次回対応日が未来" };
  }

  if (lead.contactMethod !== "問い合わせフォーム") {
    return { reason: "連絡方法が問い合わせフォームではない" };
  }

  if (!isValidUrl(lead.contactFormUrl)) {
    return { reason: "フォームURLが空またはURL形式ではない" };
  }

  if (lead.salesScore < scoreThresholdForCandidate(lead.leadType, minScore)) {
    return { reason: "営業スコアが基準未満" };
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
      formUrl: lead.contactFormUrl,
      salesScore: lead.salesScore,
      salesAngle,
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
): Promise<{ candidates: FormCandidate[]; skipped: Map<SkipReason, number> }> => {
  const table = await readSalesManagementTable(sheets);
  const salesContexts = await readAnalysisSalesContexts(sheets);
  const skipped = new Map<SkipReason, number>();
  const candidates: FormCandidate[] = [];

  table.leads.forEach((lead) => {
    if (candidates.length >= limit) {
      return;
    }

    const result = toCandidate(
      lead,
      minScore,
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
  const contentConfig = await readSalesContentConfig(sheets);
  const minScore = await readMinScore(sheets, options.minScore);
  const { candidates, skipped } = await findCandidates(sheets, options.limit, minScore, contentConfig);

  console.log("Form submission todo: this command does not submit forms.");
  console.log(`Eligible form leads: ${candidates.length}`);
  console.log(
    `Minimum sales score: ${minScore} (Web制作会社/広告代理店: ${scoreThresholdForCandidate("Web制作会社", minScore)})`
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
