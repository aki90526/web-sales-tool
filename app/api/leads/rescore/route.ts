import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { appendLeadLog } from "../../../../src/domain/leadLog";
import { previewApproximateScore } from "../../../../src/domain/rescore";
import { fieldRangeForRow, readSalesManagementTable } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

// 営業スコアの再計算（概算）。apply が true のときだけ、営業管理のスコアを書き換える（ログにも残す）
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown; apply?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";

    if (!/^L-\d{1,6}$/.test(leadId)) {
      return NextResponse.json({ message: "leadId is invalid" }, { status: 400 });
    }

    const sheets = await createSheetsClient(loadConfig());
    const table = await readSalesManagementTable(sheets);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    const preview = await previewApproximateScore(sheets, lead);

    if (body.apply !== true) {
      return NextResponse.json(preview);
    }

    await sheets.updateValues(fieldRangeForRow(table.columns, "salesScore", lead.rowNumber), [[preview.approximateScore]]);
    await appendLeadLog(sheets, [
      {
        leadId,
        kind: "その他",
        text: `営業スコアを概算で再計算しました: ${preview.currentScore} → ${preview.approximateScore}`,
        actor: "手入力",
        detail: preview.breakdown.map((item) => `${item.key}=${item.value}`).join(", ")
      }
    ]);

    return NextResponse.json({ ...preview, currentScore: preview.approximateScore, applied: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
