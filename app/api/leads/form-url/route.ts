import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { CONTACT_METHODS, STATUSES } from "../../../../src/domain/lead";
import { fieldRangeForRow, readSalesManagementTable, statusRangeForRow } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

const HISTORY_PREFIX = "フォームURL";

type Restore = { contactFormUrl: string; contactMethod: string; status: string };

const isRestore = (value: unknown): value is Restore => {
  const entry = value as Restore | null;

  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.contactFormUrl === "string" &&
    (CONTACT_METHODS as readonly string[]).includes(entry.contactMethod) &&
    (STATUSES as readonly string[]).includes(entry.status)
  );
};

// リードのフォームURLを登録・変更する。連絡方法が「未定」のリードは、フォームにして、「連絡先なし」で見送りだったものは送信待ちに戻す。
// その場合は、変更の記録をメモに1行追記する。「元に戻す」のときは、restore（元の値）と removeLine（追記した行）を渡す。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown; contactFormUrl?: unknown; restore?: unknown; removeLine?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";
    const contactFormUrl = typeof body.contactFormUrl === "string" ? body.contactFormUrl.trim() : "";

    if (!leadId) {
      return NextResponse.json({ message: "leadId is required" }, { status: 400 });
    }

    const restore = body.restore !== undefined ? body.restore : null;

    if (restore !== null && !isRestore(restore)) {
      return NextResponse.json({ message: "restore is invalid" }, { status: 400 });
    }

    if (restore === null && !/^https?:\/\/\S+$/i.test(contactFormUrl)) {
      return NextResponse.json({ message: "フォームURLは http:// または https:// で始まるURLを入力してください" }, { status: 400 });
    }

    const removeLine = typeof body.removeLine === "string" ? body.removeLine.trim() : "";

    if (removeLine && (!removeLine.startsWith(HISTORY_PREFIX) || removeLine.length > 300 || removeLine.includes("\n"))) {
      return NextResponse.json({ message: "removeLine is invalid" }, { status: 400 });
    }

    const config = loadConfig();
    const sheets = await createSheetsClient(config);
    const table = await readSalesManagementTable(sheets);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    const previous: Restore = { contactFormUrl: lead.contactFormUrl, contactMethod: lead.contactMethod, status: lead.status };
    let nextUrl = contactFormUrl;
    let nextMethod = lead.contactMethod;
    let nextStatus = lead.status;
    let memo = lead.memo;
    let historyLine = "";

    if (restore) {
      nextUrl = restore.contactFormUrl;
      nextMethod = restore.contactMethod;
      nextStatus = restore.status;

      if (removeLine) {
        const lines = memo.split("\n");
        const index = lines.lastIndexOf(removeLine);

        if (index >= 0) {
          lines.splice(index, 1);
          memo = lines.join("\n");
        }
      }
    } else {
      // 連絡方法が未定（連絡先なし）のリードは、フォームにして、「連絡先なし」で見送りだったものは送信待ちに戻す
      if (!lead.contactMethod || lead.contactMethod === "未定") {
        nextMethod = "フォーム";

        if (lead.status === "見送り" && !lead.memo.includes("除外理由")) {
          nextStatus = "送信待ち";
        }
      }

      // 連絡方法やステータスが変わるとき（と、URLが空だったとき）だけ、記録を残す。URLだけの修正は、これまでどおり、記録しない
      if (nextMethod !== lead.contactMethod || nextStatus !== lead.status || !lead.contactFormUrl) {
        const stamp = new Intl.DateTimeFormat("sv-SE", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).format(new Date());
        const parts = [
          lead.contactFormUrl ? `${HISTORY_PREFIX}を変更: ${lead.contactFormUrl} → ${contactFormUrl}` : `${HISTORY_PREFIX}を追加: ${contactFormUrl}`,
          nextMethod !== lead.contactMethod ? `連絡方法: ${lead.contactMethod || "(空)"} → ${nextMethod}` : "",
          nextStatus !== lead.status ? `ステータス: ${lead.status} → ${nextStatus}` : ""
        ].filter(Boolean);

        historyLine = `${parts.join(" / ")} (${stamp})`;
        memo = memo ? `${memo}\n${historyLine}` : historyLine;
      }
    }

    await sheets.updateValues(fieldRangeForRow(table.columns, "contactFormUrl", lead.rowNumber), [[nextUrl]]);

    if (nextMethod !== lead.contactMethod) {
      await sheets.updateValues(fieldRangeForRow(table.columns, "contactMethod", lead.rowNumber), [[nextMethod]]);
    }

    if (nextStatus !== lead.status) {
      await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [[nextStatus]]);
    }

    if (memo !== lead.memo) {
      await sheets.updateValues(fieldRangeForRow(table.columns, "memo", lead.rowNumber), [[memo]]);
    }

    return NextResponse.json({
      leadId,
      contactFormUrl: nextUrl,
      contactMethod: nextMethod,
      status: nextStatus,
      memo,
      previous,
      historyLine
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
