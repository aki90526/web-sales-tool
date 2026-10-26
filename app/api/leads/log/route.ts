import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { readLeadLog } from "../../../../src/domain/leadLog";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

// リードごとのログ（新しい順）
export async function GET(request: Request) {
  try {
    const leadId = new URL(request.url).searchParams.get("leadId")?.trim() ?? "";

    if (!/^L-\d{1,6}$/.test(leadId)) {
      return NextResponse.json({ message: "leadId is invalid" }, { status: 400 });
    }

    const sheets = await createSheetsClient(loadConfig());

    return NextResponse.json({ leadId, entries: await readLeadLog(sheets, leadId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
