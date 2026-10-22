import { NextResponse } from "next/server";
import { loadConfig } from "../../../src/config/env";
import { SHEETS } from "../../../src/domain/lead";
import { readSalesManagementTable } from "../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

const MONTHS = 12;
// 返信後のステータス。履歴の「返信あり」と合わせて、反応があったリードとして数える（ダッシュボードの「反応があった数」と同じ基準）
const RESPONDED_STATUSES = ["返信あり", "面談済み", "商談中", "保留"];

type MonthlyRow = {
  month: string;
  email: number;
  form: number;
  bounced: number;
  // その月に初めて連絡したリード数（不達だけだったものを除く）
  contacted: number;
  // そのうち、反応があったリード数
  reactions: number;
};

const monthKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const recentMonths = (): string[] => {
  const now = new Date();
  const months: string[] = [];

  for (let offset = MONTHS - 1; offset >= 0; offset -= 1) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - offset, 1)));
  }

  return months;
};

// アプローチ履歴と営業管理から、月別の送信数と、初回連絡の月ごとの反応数を集計する
export async function GET() {
  try {
    const sheets = await createSheetsClient(loadConfig());
    const [historyRows, table] = await Promise.all([
      sheets.getValues(`'${SHEETS.approachHistory}'!A:J`),
      readSalesManagementTable(sheets)
    ]);

    const months = recentMonths();
    const rows = new Map<string, MonthlyRow>(
      months.map((month) => [month, { month, email: 0, form: 0, bounced: 0, contacted: 0, reactions: 0 }])
    );

    const responded = new Set(table.leads.filter((lead) => RESPONDED_STATUSES.includes(lead.status)).map((lead) => lead.leadId));
    // リードごとの、最初に（不達ではなく）届いた送信の月
    const firstContactMonth = new Map<string, string>();

    for (const row of historyRows.slice(1)) {
      const leadId = String(row[0] ?? "").trim();
      const sentAt = String(row[1] ?? "").trim();
      const method = String(row[2] ?? "").trim();
      const sendStatus = String(row[7] ?? "").trim();
      const replyStatus = String(row[8] ?? "").trim();
      const month = /^\d{4}-\d{2}/.test(sentAt) ? sentAt.slice(0, 7) : "";

      if (!leadId || !month || sendStatus !== "送信済み") {
        continue;
      }

      if (replyStatus === "返信あり") {
        responded.add(leadId);
      }

      const monthly = rows.get(month);

      if (monthly) {
        if (method === "メール") monthly.email += 1;
        else if (method === "フォーム") monthly.form += 1;

        if (replyStatus === "不達") monthly.bounced += 1;
      }

      if (replyStatus !== "不達") {
        const current = firstContactMonth.get(leadId);

        if (!current || month < current) {
          firstContactMonth.set(leadId, month);
        }
      }
    }

    for (const [leadId, month] of firstContactMonth) {
      const monthly = rows.get(month);

      if (monthly) {
        monthly.contacted += 1;

        if (responded.has(leadId)) {
          monthly.reactions += 1;
        }
      }
    }

    return NextResponse.json({ months: months.map((month) => rows.get(month) as MonthlyRow) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
