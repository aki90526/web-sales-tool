import { NextResponse } from "next/server";
import { findFormCandidates } from "../../../../src/contact/formCandidates";
import { buildSalesMessage, readSalesContentConfig } from "../../../../src/contact/salesMessage";
import { loadConfig } from "../../../../src/config/env";
import { readAnalysisSalesContexts } from "../../../../src/google/analysisDataRepository";
import { readSalesManagementTable } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

// ブックマークレットの自動入力に使う、リード1件分のデータ（送信者情報・件名・本文）。
// 営業先のフォームに送る内容と同じもので、他のリードの情報や秘密情報は含めない。
export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    let leadId = searchParams.get("leadId")?.trim();
    const sheets = await createSheetsClient(loadConfig());

    // リードIDが空のときは、「次の対象のフォームリード」を選ぶ（「フォームを開く」と同じ）
    if (!leadId && searchParams.get("next") === "form") {
      const { candidates } = await findFormCandidates(sheets, 1, await readSalesContentConfig(sheets));
      leadId = candidates[0]?.leadId;

      if (!leadId) {
        return NextResponse.json({ message: "対象のフォームリードが見つかりません" }, { status: 404 });
      }
    }

    if (!leadId) {
      return NextResponse.json({ message: "leadId is required" }, { status: 400 });
    }

    const [table, contentConfig, salesContexts] = await Promise.all([
      readSalesManagementTable(sheets),
      readSalesContentConfig(sheets),
      readAnalysisSalesContexts(sheets)
    ]);
    const lead = table.leads.find((entry) => entry.leadId === leadId);

    if (!lead) {
      return NextResponse.json({ message: `Lead not found: ${leadId}` }, { status: 404 });
    }

    const context = salesContexts.get(leadId);
    const message = buildSalesMessage(
      {
        companyName: lead.companyName,
        leadType: lead.leadType,
        industry: lead.industry,
        region: lead.region,
        officialSiteUrl: lead.officialSiteUrl,
        salesAngle: context?.salesAngle ?? "",
        recommendedApproach: context?.recommendedApproach ?? "",
        salesMessageDraft: ""
      },
      contentConfig
    );

    return NextResponse.json({
      wstVersion: 1,
      sender: contentConfig.sender,
      formFieldAliases: contentConfig.formFieldAliases,
      candidate: { leadId, companyName: lead.companyName, subject: message.subject, body: message.body }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
