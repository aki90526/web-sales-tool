import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { appendLeadLog } from "../../../../src/domain/leadLog";
import { fieldRangeForRow, readSalesManagementTable } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

const MAX_LENGTH = 200;

// 操作者が書く「現在の状況」（1行）を更新する。更新のたびに、リードログにも残す
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown; text?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";

    if (!leadId) {
      return NextResponse.json({ message: "leadId is required" }, { status: 400 });
    }

    if (typeof body.text !== "string") {
      return NextResponse.json({ message: "text must be a string" }, { status: 400 });
    }

    const text = body.text.replace(/\s*\n\s*/g, " ").trim();

    if (text.length > MAX_LENGTH) {
      return NextResponse.json({ message: `状況は${MAX_LENGTH}文字までです` }, { status: 400 });
    }

    const sheets = await createSheetsClient(loadConfig());
    const table = await readSalesManagementTable(sheets);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    if (table.columns.currentNote < 0) {
      return NextResponse.json(
        { message: "営業管理シートに「現在の状況」の列がありません（npm run leads:migrate-log を実行してください）" },
        { status: 409 }
      );
    }

    if (text === lead.currentNote) {
      return NextResponse.json({ leadId, currentNote: text });
    }

    await sheets.updateValues(fieldRangeForRow(table.columns, "currentNote", lead.rowNumber), [[text]]);
    await appendLeadLog(sheets, [
      { leadId, kind: "状況", text: text ? `状況を更新: ${text}` : "状況をクリアしました", actor: "手入力", detail: lead.currentNote ? `前: ${lead.currentNote}` : "" }
    ]);

    return NextResponse.json({ leadId, currentNote: text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
