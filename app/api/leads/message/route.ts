import { NextResponse } from "next/server";
import { findFormCandidates } from "../../../../src/contact/formCandidates";
import { buildSalesMessage, readSalesContentConfig } from "../../../../src/contact/salesMessage";
import { loadConfig } from "../../../../src/config/env";
import { readSendRecords } from "../../../../src/domain/resend";
import { readAnalysisSalesContexts } from "../../../../src/google/analysisDataRepository";
import { readSalesManagementTable } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLeadId = searchParams.get("leadId")?.trim();
    const autoNextForm = !rawLeadId && searchParams.get("next") === "form";

    if (!rawLeadId && !autoNextForm) {
      return NextResponse.json({ message: "leadId is required" }, { status: 400 });
    }

    const config = loadConfig();
    const sheets = await createSheetsClient(config);

    if (autoNextForm) {
      const contentConfig = await readSalesContentConfig(sheets);
      const { candidates } = await findFormCandidates(sheets, 1, contentConfig);
      const candidate = candidates[0];

      if (!candidate) {
        return NextResponse.json({ message: "対象のフォームリードが見つかりません" }, { status: 404 });
      }

      return NextResponse.json({
        leadId: candidate.leadId,
        companyName: candidate.companyName,
        contactMethod: "フォーム",
        contactFormUrl: candidate.formUrl,
        subject: candidate.subject,
        body: candidate.body,
        templateId: candidate.templateId
      });
    }

    const leadId = rawLeadId as string;
    const [table, contentConfig, salesContexts, sendRecords] = await Promise.all([
      readSalesManagementTable(sheets),
      readSalesContentConfig(sheets),
      readAnalysisSalesContexts(sheets),
      readSendRecords(sheets)
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
        salesMessageDraft: "",
        channel: lead.contactMethod === "フォーム" ? "フォーム" : "メール",
        previousSentAt: sendRecords.get(leadId)?.lastSentAt || undefined
      },
      contentConfig
    );

    return NextResponse.json({
      leadId,
      companyName: lead.companyName,
      contactMethod: lead.contactMethod,
      contactFormUrl: lead.contactFormUrl,
      subject: message.subject,
      body: message.body,
      templateId: message.templateId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
