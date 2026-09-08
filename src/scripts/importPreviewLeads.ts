import { loadConfig } from "../config/env";
import { filterUniqueCandidates, formatTargetTypes, importLeadCandidates, readExistingLeadState } from "../collection/leadImport";
import { DEFAULT_PREVIEW_PATH, loadCollectPreview } from "../collection/previewStore";
import { createSheetsClient } from "../google/sheetsClient";

type CliOptions = {
  filePath: string;
  dryRun: boolean;
  help: boolean;
};

const printHelp = (): void => {
  console.log(`Usage:
  npm run collect:import
  npm run collect:import -- --dry-run
  npm run collect:import -- --path tmp/collect-preview.json

Options:
  --path       読み込むプレビューファイル。省略時は tmp/collect-preview.json
  --dry-run    スプレッドシートへ追加せず、取り込み対象だけ表示
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
    filePath: DEFAULT_PREVIEW_PATH,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--path") {
      options.filePath = nextValue(argv, index, "--path");
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const preview = await loadCollectPreview(options.filePath);
  const config = loadConfig();
  const sheets = await createSheetsClient(config);
  const existing = await readExistingLeadState(sheets);
  const uniqueCandidates = filterUniqueCandidates(preview.candidates, existing);
  const searchCondition = `地域: ${preview.area || "(unknown)"} / 対象: ${formatTargetTypes(preview.targetTypes) || "(unknown)"} / 最大件数: ${preview.limit}`;

  console.log(`Loaded preview: ${options.filePath}`);
  console.log(`Generated at: ${preview.generatedAt || "(unknown)"}`);
  console.log(`Area: ${preview.area || "(unknown)"}`);
  console.log(`Targets: ${formatTargetTypes(preview.targetTypes) || "(unknown)"}`);
  console.log(`Candidates: ${preview.candidates.length}`);
  console.log(`New unique candidates: ${uniqueCandidates.length}`);
  console.log("Sending is not automated.");

  if (uniqueCandidates.length === 0) {
    console.log("No new unique leads to import.");
    return;
  }

  if (options.dryRun) {
    console.log(JSON.stringify(uniqueCandidates, null, 2));
    return;
  }

  const results = await importLeadCandidates(sheets, uniqueCandidates, {
    searchCondition,
    searchTrace: preview.searchTrace,
    acquiredAt: preview.generatedAt || undefined
  });

  for (const result of results) {
    console.log(`Added ${result.leadId}: ${result.companyName} -> ${result.range ?? "(unknown)"}`);
    if (result.companyNameCorrection) {
      console.log(`Corrected company name: ${result.companyNameCorrection}`);
    }
    console.log(`Logged analysis data -> ${result.analysisDataRange ?? "(unknown)"}`);
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
