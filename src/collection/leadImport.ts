import { LeadType } from "../domain/lead";
import { appendAnalysisData } from "../google/analysisDataRepository";
import { appendSalesLead } from "../google/salesLeadRepository";
import { readSalesManagementTable } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";
import { LeadCandidate, toSalesLeadInput } from "../openai/leadCandidateCollector";
import { WebSearchTrace } from "../openai/openAIClient";
import { verifyCompanyName } from "./companyNameVerifier";

export type ExistingLeadState = {
  maxNumericLeadId: number;
  companies: string[];
  siteUrls: string[];
};

export type ImportedLeadResult = {
  leadId: string;
  companyName: string;
  companyNameCorrection?: string;
  range?: string;
  analysisDataRange?: string;
  rowNumber: number;
};

export type LeadImportContext = {
  searchCondition?: string;
  searchTrace?: WebSearchTrace;
  acquiredAt?: string;
};

export const readExistingLeadState = async (sheets: SheetsClient): Promise<ExistingLeadState> => {
  const table = await readSalesManagementTable(sheets);
  const companies: string[] = [];
  const siteUrls: string[] = [];
  let maxNumericLeadId = 0;

  for (const lead of table.leads) {
    const leadId = lead.leadId;
    const numericMatch = /^L-(\d+)$/.exec(leadId);

    if (numericMatch) {
      maxNumericLeadId = Math.max(maxNumericLeadId, Number(numericMatch[1]));
    }

    if (lead.companyName) {
      companies.push(lead.companyName);
    }

    if (lead.officialSiteUrl) {
      siteUrls.push(lead.officialSiteUrl);
    }
  }

  return {
    maxNumericLeadId,
    companies,
    siteUrls
  };
};

export const leadKey = (value: string): string => {
  return value.trim().toLowerCase().replace(/\/$/, "");
};

export const filterUniqueCandidates = (
  candidates: LeadCandidate[],
  existing: ExistingLeadState
): LeadCandidate[] => {
  const seenCompanies = new Set(existing.companies.map(leadKey));
  const seenSiteUrls = new Set(existing.siteUrls.map(leadKey));

  return candidates.filter((candidate) => {
    const companyKey = leadKey(candidate.companyName);
    const siteUrlKey = leadKey(candidate.officialSiteUrl);

    if (seenCompanies.has(companyKey) || seenSiteUrls.has(siteUrlKey)) {
      return false;
    }

    seenCompanies.add(companyKey);
    seenSiteUrls.add(siteUrlKey);
    return true;
  });
};

export const nextLeadId = (numericId: number): string => {
  return `L-${String(numericId).padStart(4, "0")}`;
};

export const importLeadCandidates = async (
  sheets: SheetsClient,
  candidates: LeadCandidate[],
  context: LeadImportContext = {}
): Promise<ImportedLeadResult[]> => {
  const existing = await readExistingLeadState(sheets);
  const uniqueCandidates = filterUniqueCandidates(candidates, existing);
  const results: ImportedLeadResult[] = [];
  let nextNumericId = existing.maxNumericLeadId + 1;

  for (const candidate of uniqueCandidates) {
    const leadId = nextLeadId(nextNumericId);
    const verification = await verifyCompanyName(candidate);
    const verifiedCandidate = verification.candidate;
    const lead = toSalesLeadInput(verifiedCandidate, leadId);
    const result = await appendSalesLead(sheets, lead);
    const analysisDataResult = await appendAnalysisData(sheets, {
      leadId,
      targetUrl: lead.officialSiteUrl,
      acquiredAt: context.acquiredAt ?? new Date().toISOString(),
      pageType: verifiedCandidate.pageType,
      analyzedAt: context.acquiredAt ?? new Date().toISOString(),
      mobileResponsive: verifiedCandidate.mobileResponsive,
      seoBasics: verifiedCandidate.seoBasics,
      cta: verifiedCandidate.cta,
      contactFlow: verifiedCandidate.contactFlow,
      updateStatus: verifiedCandidate.updateStatus,
      ssl: verifiedCandidate.ssl,
      cms: verifiedCandidate.cms,
      improvementPoints: verifiedCandidate.improvementPoints,
      recommendedApproach: verifiedCandidate.recommendedApproach,
      estimatedRenewalPeriod: verifiedCandidate.estimatedRenewalPeriod,
      renewalConfidence: verifiedCandidate.renewalConfidence,
      renewalEvidence: verifiedCandidate.renewalEvidence,
      aiAnalysis: verifiedCandidate.aiAnalysis,
      aiAdjustment: verifiedCandidate.aiAdjustment,
      aiAdjustmentReason: verifiedCandidate.aiAdjustmentReason,
      baseScore: verifiedCandidate.baseScore,
      salesScore: verifiedCandidate.salesScore,
      scoreBreakdown: verifiedCandidate.scoreBreakdown,
      exclusionReason: verifiedCandidate.exclusionReason,
      searchCondition: context.searchCondition ?? "",
      searchQueries: context.searchTrace?.queries ?? [],
      sourceUrls: context.searchTrace?.sourceUrls ?? [],
      capital: verifiedCandidate.capital,
      employeeCount: verifiedCandidate.employeeCount,
      annualRevenue: verifiedCandidate.annualRevenue,
      listingStatus: verifiedCandidate.listingStatus,
      companySizeCategory: verifiedCandidate.companySizeCategory,
      companySizeMemo: verifiedCandidate.companySizeMemo,
      salesAngle: verifiedCandidate.salesAngle
    });

    results.push({
      leadId,
      companyName: lead.companyName,
      companyNameCorrection: verification.correction
        ? `${verification.correction.from} -> ${verification.correction.to} (${verification.correction.sourceUrl})`
        : undefined,
      range: result.range,
      analysisDataRange: analysisDataResult.range,
      rowNumber: result.rowNumber
    });

    nextNumericId += 1;
  }

  return results;
};

export const formatTargetTypes = (targetTypes: LeadType[]): string => {
  return targetTypes.join(", ");
};
