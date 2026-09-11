import { NextResponse } from "next/server";
import {
  DashboardCommand,
  listDashboardJobs,
  runDashboardJob
} from "../../../src/dashboard/jobRunner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const isDashboardCommand = (value: unknown): value is DashboardCommand => {
  return (
    value === "email-dry-run" ||
    value === "email-test" ||
    value === "email-send" ||
    value === "forms-todo" ||
    value === "forms-fill" ||
    value === "forms-mark-sent" ||
    value === "gmail-dry-run" ||
    value === "gmail-sync"
  );
};

export async function GET() {
  try {
    return NextResponse.json(await listDashboardJobs());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (!isDashboardCommand(body.command)) {
      return NextResponse.json({ message: "command is invalid" }, { status: 400 });
    }

    const job = await runDashboardJob({
      command: body.command,
      limit: body.limit,
      leadId: body.leadId,
      testTo: body.testTo,
      note: body.note,
      confirm: body.confirm
    });

    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("実行中") ? 409 : 400;
    return NextResponse.json({ message }, { status });
  }
}
