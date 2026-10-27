import { NextResponse } from "next/server";
import { loadConfig } from "../../../src/config/env";
import { latestLogByLead, readAllLeadLogs, recheckStateFromLog, skipCountFromLog } from "../../../src/domain/leadLog";
import { readResendSettings } from "../../../src/domain/resend";
import { readSalesManagementTable } from "../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = loadConfig();
    const sheets = await createSheetsClient(config);
    const [table, settings, logs] = await Promise.all([
      readSalesManagementTable(sheets),
      readResendSettings(sheets),
      readAllLeadLogs(sheets)
    ]);
    const latest = latestLogByLead(logs);
    const byLead = new Map<string, typeof logs>();

    logs.forEach((entry) => byLead.set(entry.leadId, [...(byLead.get(entry.leadId) ?? []), entry]));

    // 一覧に出す、いちばん新しいログと、見送りの再確認の基準日（ログから）
    const leads = table.leads.map((lead) => {
      const entry = latest.get(lead.leadId);

      return {
        ...lead,
        latestLog: entry ? { at: entry.at, kind: entry.kind, text: entry.text, actor: entry.actor } : null,
        recheckBaseDate: lead.status === "見送り" ? recheckStateFromLog(byLead.get(lead.leadId) ?? []).lastDate : "",
        // リードごとの期間を決めていないときに使う日数（見送りが2回目以降なら、長い方）
        recheckDefaultDaysForLead:
          skipCountFromLog(byLead.get(lead.leadId) ?? [], lead.status) >= 2 ? settings.recheckLaterIntervalDays : settings.recheckIntervalDays
      };
    });

    return NextResponse.json({ leads, recheckDefaultDays: settings.recheckIntervalDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
