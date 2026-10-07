import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { STATUSES, Status } from "../../../../src/domain/lead";
import { readSalesManagementTable, statusRangeForRow } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

const isStatus = (value: unknown): value is Status => {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown; status?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";

    if (!leadId) {
      return NextResponse.json({ message: "leadId is required" }, { status: 400 });
    }

    if (!isStatus(body.status)) {
      return NextResponse.json(
        { message: `status must be one of: ${STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const config = loadConfig();
    const sheets = await createSheetsClient(config);
    const table = await readSalesManagementTable(sheets);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [[body.status]]);

    return NextResponse.json({ leadId, status: body.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
