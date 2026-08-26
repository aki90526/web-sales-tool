import { loadConfig, requireOpenAiConfig } from "../config/env";
import { LeadType, SHEETS } from "../domain/lead";
import { createSheetsClient, SheetsClient } from "../google/sheetsClient";
import { appendSalesLead } from "../google/salesLeadRepository";
import { collectLeadCandidates, toSalesLeadInput } from "../openai/leadCandidateCollector";
import { createOpenAIClient } from "../openai/openAIClient";

type CliOptions = {
  area: string;
  targetTypes: LeadType[];
  limit: number;
  dryRun: boolean;
  help: boolean;
};

type ExistingLeadState = {
  maxNumericLeadId: number;
  companies: string[];
  siteUrls: string[];
};

const MAX_INITIAL_LIMIT = 10;

const today = (): string => {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
};

const printHelp = (): void => {
  console.log(`Usage:
  npm run collect -- --area "埼玉県春日部市" --target "制作会社,直クライアント" --limit 10
  npm run collect -- --area "埼玉県" --target "広告代理店,制作会社" --limit 5 --dry-run

Options:
  --area       検索対象地域。省略時は "埼玉県春日部市"
  --target     対象種別。広告代理店, 制作会社, Web制作会社, 直クライアント, 事業者
  --limit      追加候補数。初期安全上限は10件
  --dry-run    スプレッドシートへ追加せず結果だけ表示
`);
};

const nextValue = (args: string[], index: number, name: string): string => {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
};

const parseTargetTypes = (value: string): LeadType[] => {
  const tokens = value
    .split(/[,\s、]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const types = new Set<LeadType>();

  for (const token of tokens) {
    if (token === "広告代理店" || token.toLowerCase() === "agency") {
      types.add("広告代理店");
    } else if (token === "制作会社" || token === "Web制作会社") {
      types.add("Web制作会社");
    } else if (token === "直クライアント" || token === "事業者") {
      types.add("直クライアント");
    }
  }

  if (types.size === 0) {
    throw new Error("Invalid --target. Use 制作会社, 広告代理店, 直クライアント, or 事業者.");
  }

  return Array.from(types);
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    area: "埼玉県春日部市",
    targetTypes: ["Web制作会社", "直クライアント"],
    limit: 10,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--area") {
      options.area = nextValue(argv, index, "--area");
      index += 1;
    } else if (arg === "--target") {
      options.targetTypes = parseTargetTypes(nextValue(argv, index, "--target"));
      index += 1;
    } else if (arg === "--limit") {
      options.limit = Number(nextValue(argv, index, "--limit"));
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("--limit must be a positive integer");
  }

  if (options.limit > MAX_INITIAL_LIMIT) {
    throw new Error(`初期運用の安全上限は${MAX_INITIAL_LIMIT}件です。--limit ${MAX_INITIAL_LIMIT} 以下で実行してください。`);
  }

  return options;
};

const readExistingLeadState = async (sheets: SheetsClient): Promise<ExistingLeadState> => {
  const values = await sheets.getValues(`'${SHEETS.salesManagement}'!A2:F1000`);
  const companies: string[] = [];
  const siteUrls: string[] = [];
  let maxNumericLeadId = 0;

  for (const row of values) {
    const leadId = String(row[0] ?? "").trim();
    const numericMatch = /^L-(\d+)$/.exec(leadId);
    const company = String(row[1] ?? "").trim();
    const siteUrl = String(row[5] ?? "").trim();

    if (numericMatch) {
      maxNumericLeadId = Math.max(maxNumericLeadId, Number(numericMatch[1]));
    }

    if (company) {
      companies.push(company);
    }

    if (siteUrl) {
      siteUrls.push(siteUrl);
    }
  }

  return {
    maxNumericLeadId,
    companies,
    siteUrls
  };
};

const leadKey = (value: string): string => {
  return value.trim().toLowerCase().replace(/\/$/, "");
};

const nextLeadId = (numericId: number): string => {
  return `L-${String(numericId).padStart(4, "0")}`;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const openAiConfig = requireOpenAiConfig(config);
  const sheets = await createSheetsClient(config);
  const existing = await readExistingLeadState(sheets);
  const openAI = createOpenAIClient(openAiConfig);

  console.log(`Collecting up to ${options.limit} leads. Sending is not automated.`);
  console.log(`Area: ${options.area}`);
  console.log(`Targets: ${options.targetTypes.join(", ")}`);

  const candidates = await collectLeadCandidates(openAI, {
    area: options.area,
    targetTypes: options.targetTypes,
    limit: options.limit,
    existingCompanies: existing.companies,
    existingSiteUrls: existing.siteUrls
  });

  const seenCompanies = new Set(existing.companies.map(leadKey));
  const seenSiteUrls = new Set(existing.siteUrls.map(leadKey));
  const uniqueCandidates = candidates.filter((candidate) => {
    const companyKey = leadKey(candidate.companyName);
    const siteUrlKey = leadKey(candidate.officialSiteUrl);

    if (seenCompanies.has(companyKey) || seenSiteUrls.has(siteUrlKey)) {
      return false;
    }

    seenCompanies.add(companyKey);
    seenSiteUrls.add(siteUrlKey);
    return true;
  });

  if (uniqueCandidates.length === 0) {
    console.log("No new unique leads found.");
    return;
  }

  if (options.dryRun) {
    console.log(JSON.stringify(uniqueCandidates, null, 2));
    return;
  }

  const updatedAt = today();
  let nextNumericId = existing.maxNumericLeadId + 1;

  for (const candidate of uniqueCandidates) {
    const leadId = nextLeadId(nextNumericId);
    const lead = toSalesLeadInput(candidate, leadId, updatedAt);
    const result = await appendSalesLead(sheets, lead);

    console.log(`Added ${leadId}: ${lead.companyName} -> ${result.range ?? "(unknown)"}`);
    nextNumericId += 1;
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
