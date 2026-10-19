import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { fieldRangeForRow, readSalesManagementTable } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown; contactFormUrl?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";
    const contactFormUrl = typeof body.contactFormUrl === "string" ? body.contactFormUrl.trim() : "";

    if (!leadId) {
      return NextResponse.json({ message: "leadId is required" }, { status: 400 });
    }

    if (!/^https?:\/\/\S+$/i.test(contactFormUrl)) {
      return NextResponse.json({ message: "フォームURLは http:// または https:// で始まるURLを入力してください" }, { status: 400 });
    }

    const config = loadConfig();
    const sheets = await createSheetsClient(config);
    const table = await readSalesManagementTable(sheets);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    await sheets.updateValues(fieldRangeForRow(table.columns, "contactFormUrl", lead.rowNumber), [[contactFormUrl]]);

    return NextResponse.json({ leadId, contactFormUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
