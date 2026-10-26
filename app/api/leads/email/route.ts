import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { CONTACT_METHODS, STATUSES } from "../../../../src/domain/lead";
import { isValidEmail } from "../../../../src/email/emailList";
import { fieldRangeForRow, readSalesManagementTable, statusRangeForRow } from "../../../../src/google/salesManagementRepository";
import { appendLeadLog } from "../../../../src/domain/leadLog";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

const HISTORY_PREFIX = "メールアドレス";

type Restore = { email: string; contactMethod: string; status: string };

const isRestore = (value: unknown): value is Restore => {
  const entry = value as Restore | null;

  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.email === "string" &&
    (CONTACT_METHODS as readonly string[]).includes(entry.contactMethod) &&
    (STATUSES as readonly string[]).includes(entry.status)
  );
};

// リードのメールアドレスを登録・変更する（画像で貼られていたアドレスを見つけた場合など）。
// 変更の記録をメモに1行追記する。「元に戻す」のときは、restore（元の値）と removeLine（追記した行）を渡す。
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown; email?: unknown; restore?: unknown; removeLine?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";

    if (!leadId) {
      return NextResponse.json({ message: "leadId is required" }, { status: 400 });
    }

    const restore = body.restore !== undefined ? body.restore : null;

    if (restore !== null && !isRestore(restore)) {
      return NextResponse.json({ message: "restore is invalid" }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (restore === null && !isValidEmail(email)) {
      return NextResponse.json({ message: "メールアドレスの形式が正しくありません" }, { status: 400 });
    }

    const removeLine = typeof body.removeLine === "string" ? body.removeLine.trim() : "";

    if (removeLine && (!removeLine.startsWith(HISTORY_PREFIX) || removeLine.length > 300 || removeLine.includes("\n"))) {
      return NextResponse.json({ message: "removeLine is invalid" }, { status: 400 });
    }

    const sheets = await createSheetsClient(loadConfig());
    const table = await readSalesManagementTable(sheets);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    const previous: Restore = { email: lead.emailAddress, contactMethod: lead.contactMethod, status: lead.status };
    let nextEmail = email;
    let nextMethod = lead.contactMethod;
    let nextStatus = lead.status;
    const memo = lead.memo;
    let historyLine = "";
    let logText = "";

    if (restore) {
      // 元に戻す: 値を戻し、そのとき追記した行を、メモから消す
      nextEmail = restore.email;
      nextMethod = restore.contactMethod;
      nextStatus = restore.status;

      logText = "メールアドレスの変更を元に戻しました";
    } else {
      // メールを優先する。フォーム・未定のリードは、ステータスを問わず（フォームで送信済みのリードも）、連絡方法をメールにする
      if (lead.contactMethod !== "メール") {
        nextMethod = "メール";
      }

      // 「連絡先なし」で見送りになっていたリード（連絡方法が未定で、除外理由が無い）は、送信待ちに戻す
      if (lead.status === "見送り" && lead.contactMethod === "未定" && !lead.memo.includes("除外理由")) {
        nextStatus = "送信待ち";
      }

      const parts = [
        lead.emailAddress ? `${HISTORY_PREFIX}を変更: ${lead.emailAddress} → ${email}` : `${HISTORY_PREFIX}を追加: ${email}`,
        nextMethod !== lead.contactMethod ? `連絡方法: ${lead.contactMethod || "(空)"} → ${nextMethod}` : "",
        nextStatus !== lead.status ? `ステータス: ${lead.status} → ${nextStatus}` : ""
      ].filter(Boolean);
      const stamp = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date());

      historyLine = `${parts.join(" / ")} (${stamp})`;
      logText = parts.join(" / ");
    }

    await sheets.updateValues(fieldRangeForRow(table.columns, "emailAddress", lead.rowNumber), [[nextEmail]]);

    if (nextMethod !== lead.contactMethod) {
      await sheets.updateValues(fieldRangeForRow(table.columns, "contactMethod", lead.rowNumber), [[nextMethod]]);
    }

    if (nextStatus !== lead.status) {
      await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [[nextStatus]]);
    }

    // 履歴は、メモではなく、リードログに残す
    if (logText) {
      await appendLeadLog(sheets, [{ leadId, kind: "連絡先", text: logText, actor: "手入力" }]);
    }

    return NextResponse.json({
      leadId,
      emailAddress: nextEmail,
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
