import { NextResponse } from "next/server";
import { loadConfig } from "../../../src/config/env";
import { isValidEmail } from "../../../src/email/emailList";
import { readSalesManagementTable } from "../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

const tokyoToday = (): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const isFutureDate = (dateText: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(dateText) && dateText > tokyoToday();

// 「送信待ち」のリードのうち、今すぐ送信できる件数（メール送信・フォーム対象確認と同じ条件）
export async function GET() {
  try {
    const sheets = await createSheetsClient(loadConfig());
    const table = await readSalesManagementTable(sheets);
    const waiting = table.leads.filter((lead) => lead.status === "送信待ち" && !isFutureDate(lead.nextActionDate));

    const email = waiting.filter((lead) => lead.contactMethod === "メール" && isValidEmail(lead.emailAddress)).length;
    const forms = waiting.filter((lead) => lead.contactMethod === "フォーム" && /^https?:\/\//i.test(lead.contactFormUrl));
    const formManualOnly = forms.filter((lead) => lead.memo.includes("[CAPTCHA]")).length;

    return NextResponse.json({
      email,
      form: forms.length,
      formAuto: forms.length - formManualOnly,
      formManualOnly
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
