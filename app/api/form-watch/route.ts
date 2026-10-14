import { NextResponse } from "next/server";
import { FormWatchEntry, readFormWatchStatus, upsertFormWatchEntry } from "../../../src/form/formWatchStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { leadId?: unknown; state?: unknown; message?: unknown };
  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const entry = readFormWatchStatus().find((candidate) => candidate.leadId === leadId);

  if (!entry || body.state !== "recorded") {
    return NextResponse.json({ message: "invalid request" }, { status: 400 });
  }

  upsertFormWatchEntry(entry.leadId, entry.companyName, {
    state: "recorded",
    message: typeof body.message === "string" ? body.message : "手動で「送信済み」に更新しました"
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const now = Date.now();
  const entries: FormWatchEntry[] = readFormWatchStatus().map((entry) => {
    const stale = entry.state === "watching" && now - new Date(entry.heartbeatAt).getTime() > HEARTBEAT_TIMEOUT_MS;

    return stale
      ? {
          ...entry,
          state: "closed",
          message: "見張りの処理が止まっています（送信した場合は手動で「送信済みにする」を押してください）"
        }
      : entry;
  });

  return NextResponse.json({ entries });
}
