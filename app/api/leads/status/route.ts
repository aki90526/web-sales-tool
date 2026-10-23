import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { STATUSES, Status } from "../../../../src/domain/lead";
import { fieldRangeForRow, readSalesManagementTable, statusRangeForRow } from "../../../../src/google/salesManagementRepository";
import { clearRecheckDays, normalizeRecheckInput, setRecheckDays } from "../../../../src/domain/skipTracking";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

const isStatus = (value: unknown): value is Status => {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
};

const HISTORY_PREFIX = "ステータス変更:";

const formatTokyoDateTime = (date: Date): string =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);

// ステータスを変更し、変更の履歴をメモに1行追記する。
// 「元に戻す」のときは、removeLine に、そのとき追記した行を渡すと、ステータスを戻して、その行をメモから消す。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown; status?: unknown; removeLine?: unknown; recheckDays?: unknown };
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

    // 見送りにするときの、再確認までの日数（日数 / "なし" / 空 = 設定シートの既定）
    const recheckDays = normalizeRecheckInput(body.recheckDays);

    if (recheckDays === null) {
      return NextResponse.json({ message: "recheckDays must be a number of days (1-3650) or \"なし\"" }, { status: 400 });
    }

    const removeLine = typeof body.removeLine === "string" ? body.removeLine.trim() : "";

    if (removeLine && (!removeLine.startsWith(HISTORY_PREFIX) || removeLine.length > 200 || removeLine.includes("\n"))) {
      return NextResponse.json({ message: "removeLine is invalid" }, { status: 400 });
    }

    const config = loadConfig();
    const sheets = await createSheetsClient(config);
    const table = await readSalesManagementTable(sheets);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    const previousStatus = lead.status;

    if (previousStatus === body.status && !removeLine) {
      // すでに見送りのリードで、再確認までの日数だけを変える場合
      if (body.status === "見送り" && body.recheckDays !== undefined) {
        await setRecheckDays(sheets, table, lead, recheckDays);
        return NextResponse.json({ leadId, status: body.status, previousStatus, memo: lead.memo, historyLine: "", recheckDays });
      }

      return NextResponse.json({ leadId, status: body.status, previousStatus, memo: lead.memo, historyLine: "", recheckDays: lead.recheckDays });
    }

    let memo = lead.memo;
    let historyLine = "";

    if (removeLine) {
      // 元に戻す: そのとき追記した行を、メモから消す（いちばん後ろの一致を1つだけ）
      const lines = memo.split("\n");
      const index = lines.lastIndexOf(removeLine);

      if (index >= 0) {
        lines.splice(index, 1);
        memo = lines.join("\n");
      }
    } else {
      historyLine = `${HISTORY_PREFIX} ${previousStatus || "(空)"} → ${body.status} (${formatTokyoDateTime(new Date())})`;
      memo = memo ? `${memo}\n${historyLine}` : historyLine;
    }

    await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [[body.status]]);

    if (memo !== lead.memo) {
      await sheets.updateValues(fieldRangeForRow(table.columns, "memo", lead.rowNumber), [[memo]]);
    }

    // 見送りにしたら、再確認までの日数を書く。見送りでなくなったら、その指定を消す
    let nextRecheckDays = lead.recheckDays;

    if (body.status === "見送り" && previousStatus !== "見送り" && !removeLine) {
      await setRecheckDays(sheets, table, lead, recheckDays);
      nextRecheckDays = recheckDays;
    } else if (previousStatus === "見送り" && body.status !== "見送り") {
      await clearRecheckDays(sheets, table, lead);
      nextRecheckDays = "";
    }

    return NextResponse.json({ leadId, status: body.status, previousStatus, memo, historyLine, recheckDays: nextRecheckDays });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
