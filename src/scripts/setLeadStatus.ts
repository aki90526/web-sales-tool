import { loadConfig } from "../config/env";
import { STATUSES, Status } from "../domain/lead";
import { readSalesManagementTable, statusRangeForRow } from "../google/salesManagementRepository";
import { normalizeRecheckInput, setRecheckDays } from "../domain/skipTracking";
import { appendLeadLog } from "../domain/leadLog";
import { createSheetsClient } from "../google/sheetsClient";

const printHelp = (): void => {
  console.log(`Usage:
  npm run leads:set-status -- --lead-id L-0004 --status 見送り
  npm run leads:set-status -- --lead-id L-0004 --status 保留 --note "来月再検討"

Options:
  --lead-id    ステータスを変更するリードID（必須）
  --status     変更後のステータス（${STATUSES.join(" / ")}）
  --note       理由など。メモ欄に「ステータス変更: ...」として追記します
  --recheck-days  見送りにするときの、再確認までの日数（数字 / なし）。省略時は設定シートの既定
`);
};

const nextValue = (args: string[], index: number, name: string): string => {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
};

const formatTokyoDate = (date: Date): string => {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  let leadId = "";
  let status = "";
  let note = "";
  let recheckDaysArg = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    } else if (arg === "--lead-id") {
      leadId = nextValue(args, index, "--lead-id");
      index += 1;
    } else if (arg === "--status") {
      status = nextValue(args, index, "--status");
      index += 1;
    } else if (arg === "--note") {
      note = nextValue(args, index, "--note");
      index += 1;
    } else if (arg === "--recheck-days") {
      recheckDaysArg = nextValue(args, index, "--recheck-days");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!leadId) {
    throw new Error("--lead-id is required");
  }

  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new Error(`--status must be one of: ${STATUSES.join(", ")}`);
  }

  const sheets = await createSheetsClient(loadConfig());
  const table = await readSalesManagementTable(sheets);
  const lead = table.leads.find((candidate) => candidate.leadId === leadId);

  if (!lead) {
    throw new Error(`Lead not found: ${leadId}`);
  }

  const recheckDays = normalizeRecheckInput(recheckDaysArg);

  if (recheckDays === null) {
    throw new Error('--recheck-days must be a number of days (1-3650) or "なし"');
  }

  await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [[status as Status]]);
  await appendLeadLog(sheets, [
    { leadId: lead.leadId, kind: "ステータス変更", text: `${lead.status || "(空)"} → ${status}${note ? ` ${note}` : ""}`, actor: "手入力" }
  ]);

  if (status === "見送り" && lead.status !== "見送り") {
    await setRecheckDays(sheets, table, lead, recheckDays);
  }

  console.log(`${lead.leadId} ${lead.companyName}: ${lead.status || "(空)"} -> ${status}`);
  console.log(`[DASHBOARD_UPDATE] leadId=${lead.leadId} company=${lead.companyName} type=status detail=${lead.status || "(空)"} → ${status}`);
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
