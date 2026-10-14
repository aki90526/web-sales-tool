import { NextResponse } from "next/server";
import { loadConfig } from "../../../src/config/env";
import { SHEETS } from "../../../src/domain/lead";
import { createSheetsClient } from "../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

// アプローチ履歴から、これまでに連絡したリードと、返信があったリードのIDを集計する
export async function GET() {
  try {
    const sheets = await createSheetsClient(loadConfig());
    const rows = await sheets.getValues(`'${SHEETS.approachHistory}'!A1:J2000`);
    const contacted = new Set<string>();
    const responded = new Set<string>();

    rows.slice(1).forEach((row) => {
      const leadId = String(row[0] ?? "").trim();
      const sendStatus = String(row[7] ?? "").trim();
      const replyStatus = String(row[8] ?? "").trim();

      if (!leadId) {
        return;
      }

      if (sendStatus === "送信済み") {
        contacted.add(leadId);
      }

      if (replyStatus === "返信あり") {
        responded.add(leadId);
      }
    });

    return NextResponse.json({ contactedLeadIds: Array.from(contacted), respondedLeadIds: Array.from(responded) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
