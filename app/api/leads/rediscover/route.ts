import { NextResponse } from "next/server";
import { rediscoverContact } from "../../../../src/collection/contactRediscovery";
import { loadConfig } from "../../../../src/config/env";
import { readSalesManagementTable } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// リードの連絡先を、公式サイトから探し直した結果を返す（提案だけ。シートは変えない。AIは使わない）
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";

    if (!/^L-\d{1,6}$/.test(leadId)) {
      return NextResponse.json({ message: "leadId is invalid" }, { status: 400 });
    }

    const sheets = await createSheetsClient(loadConfig());
    const table = await readSalesManagementTable(sheets);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    return NextResponse.json(await rediscoverContact(lead));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
