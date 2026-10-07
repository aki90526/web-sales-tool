import { SalesContentConfig, buildSalesMessage } from "./salesMessage";
import { readAnalysisSalesContexts } from "../google/analysisDataRepository";
import {
  readSalesManagementTable,
  SalesManagementLead
} from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";

export type FormCandidate = {
  rowNumber: number;
  leadId: string;
  companyName: string;
  leadType: string;
  industry: string;
  region: string;
  officialSiteUrl: string;
  formUrl: string;
  salesScore: number;
  salesAngle: string;
  subject: string;
  body: string;
  templateId: string;
};

export type FormSkipReason =
  | "ステータスが送信待ちではない"
  | "次回対応日が未来"
  | "連絡方法がフォームではない"
  | "フォームURLが空またはURL形式ではない"
  | "CAPTCHA検出済みのため自動対象外";

const isValidUrl = (value: string): boolean => {
  return /^https?:\/\//i.test(value);
};

const formatTokyoDate = (date: Date): string => {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

const isFutureDate = (dateText: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return false;
  }

  return dateText > formatTokyoDate(new Date());
};

const toFormCandidate = (
  lead: SalesManagementLead,
  contentConfig: SalesContentConfig,
  recommendedApproach: string,
  salesAngle: string
): { candidate?: FormCandidate; reason?: FormSkipReason } => {
  if (lead.status !== "送信待ち") {
    return { reason: "ステータスが送信待ちではない" };
  }

  if (isFutureDate(lead.nextActionDate)) {
    return { reason: "次回対応日が未来" };
  }

  if (lead.contactMethod !== "フォーム") {
    return { reason: "連絡方法がフォームではない" };
  }

  if (!isValidUrl(lead.contactFormUrl)) {
    return { reason: "フォームURLが空またはURL形式ではない" };
  }

  if (lead.memo.includes("[CAPTCHA]")) {
    return { reason: "CAPTCHA検出済みのため自動対象外" };
  }

  const message = buildSalesMessage(
    {
      companyName: lead.companyName,
      leadType: lead.leadType,
      industry: lead.industry,
      region: lead.region,
      officialSiteUrl: lead.officialSiteUrl,
      salesAngle,
      recommendedApproach,
      salesMessageDraft: ""
    },
    contentConfig
  );

  return {
    candidate: {
      rowNumber: lead.rowNumber,
      leadId: lead.leadId,
      companyName: lead.companyName,
      leadType: lead.leadType,
      industry: lead.industry,
      region: lead.region,
      officialSiteUrl: lead.officialSiteUrl,
      formUrl: lead.contactFormUrl,
      salesScore: lead.salesScore,
      salesAngle,
      subject: message.subject,
      body: message.body,
      templateId: message.templateId
    }
  };
};

export const findFormCandidates = async (
  sheets: SheetsClient,
  limit: number,
  contentConfig: SalesContentConfig
): Promise<{ candidates: FormCandidate[]; skipped: Map<FormSkipReason, number> }> => {
  const table = await readSalesManagementTable(sheets);
  const salesContexts = await readAnalysisSalesContexts(sheets);
  const skipped = new Map<FormSkipReason, number>();
  const candidates: FormCandidate[] = [];

  table.leads.forEach((lead) => {
    if (candidates.length >= limit) {
      return;
    }

    const result = toFormCandidate(
      lead,
      contentConfig,
      salesContexts.get(lead.leadId)?.recommendedApproach ?? "",
      salesContexts.get(lead.leadId)?.salesAngle ?? ""
    );

    if (result.candidate) {
      candidates.push(result.candidate);
      return;
    }

    if (result.reason) {
      skipped.set(result.reason, (skipped.get(result.reason) ?? 0) + 1);
    }
  });

  return { candidates, skipped };
};
