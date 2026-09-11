import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

const HISTORY_PATH = path.resolve(process.cwd(), "data", "collect-history.json");

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return NextResponse.json({ history: Array.isArray(parsed) ? parsed : [] });
  } catch {
    return NextResponse.json({ history: [] });
  }
}
