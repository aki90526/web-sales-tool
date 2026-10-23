import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { previewTemplate, readSalesContentConfig } from "../../../../src/contact/salesMessage";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { subject?: unknown; body?: unknown; channel?: unknown; leadType?: unknown; purpose?: unknown };

    if (typeof body.subject !== "string" || typeof body.body !== "string" || body.body.length > 5000 || body.subject.length > 200) {
      return NextResponse.json({ message: "invalid input" }, { status: 400 });
    }

    const channel = body.channel === "メール" || body.channel === "フォーム" ? body.channel : "";
    const purpose = body.purpose === "再送" ? "再送" : "初回";
    const leadType = typeof body.leadType === "string" ? body.leadType : "Web制作会社";
    const config = await readSalesContentConfig(await createSheetsClient(loadConfig()));

    return NextResponse.json(previewTemplate({ subject: body.subject, body: body.body, channel, leadType, purpose }, config));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
