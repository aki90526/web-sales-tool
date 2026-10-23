import { NextResponse } from "next/server";
import { loadConfig } from "../../../src/config/env";
import { FOLLOW_UP_PLACEHOLDERS } from "../../../src/contact/salesMessage";
import { createSheetsClient } from "../../../src/google/sheetsClient";
import { AppSettingsUpdate, readAppSettings, saveAppSettings } from "../../../src/settings/appSettings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sheets = await createSheetsClient(loadConfig());
    const settings = await readAppSettings(sheets);

    return NextResponse.json({ ...settings, placeholders: FOLLOW_UP_PLACEHOLDERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AppSettingsUpdate;

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ message: "invalid body" }, { status: 400 });
    }

    const sheets = await createSheetsClient(loadConfig());

    try {
      await saveAppSettings(sheets, body);
    } catch (error) {
      // 入力の誤り（検証エラー）は、そのまま画面に伝える
      return NextResponse.json({ message: error instanceof Error ? error.message : "invalid input" }, { status: 400 });
    }

    return NextResponse.json({ ...(await readAppSettings(sheets)), placeholders: FOLLOW_UP_PLACEHOLDERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
