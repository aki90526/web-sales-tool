import { NextResponse } from "next/server";
import { loadConfig } from "../../../src/config/env";
import { readResendSettings } from "../../../src/domain/resend";
import { readSalesManagementTable } from "../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = loadConfig();
    const sheets = await createSheetsClient(config);
    const [table, settings] = await Promise.all([readSalesManagementTable(sheets), readResendSettings(sheets)]);

    return NextResponse.json({ leads: table.leads, recheckDefaultDays: settings.recheckIntervalDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
