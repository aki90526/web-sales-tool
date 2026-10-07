import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { fieldRangeForRow, readSalesManagementTable } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown; memo?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";

    if (!leadId) {
      return NextResponse.json({ message: "leadId is required" }, { status: 400 });
    }

    if (typeof body.memo !== "string") {
      return NextResponse.json({ message: "memo must be a string" }, { status: 400 });
    }

    const config = loadConfig();
    const sheets = await createSheetsClient(config);
    const table = await readSalesManagementTable(sheets);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    await sheets.updateValues(fieldRangeForRow(table.columns, "memo", lead.rowNumber), [[body.memo]]);

    return NextResponse.json({ leadId, memo: body.memo });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
