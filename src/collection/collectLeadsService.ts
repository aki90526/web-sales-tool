import { AppConfig, requireOpenAiConfig } from "../config/env";
import { LeadType } from "../domain/lead";
import { createSheetsClient, SheetsClient } from "../google/sheetsClient";
import { collectLeadCandidateCollection, LeadCandidate } from "../openai/leadCandidateCollector";
import { createOpenAIClient, WebSearchTrace } from "../openai/openAIClient";
import { filterUniqueCandidates, formatTargetTypes, readExistingLeadState } from "./leadImport";

export const MAX_INITIAL_LIMIT = 10;

export type CollectRunOptions = {
  area: string;
  targetTypes: LeadType[];
  limit: number;
};

export type CollectRunResult = {
  searchTrace: WebSearchTrace;
  candidates: LeadCandidate[];
};

export const buildSearchCondition = (options: CollectRunOptions): string => {
  return `地域: ${options.area} / 対象: ${formatTargetTypes(options.targetTypes)} / 最大件数: ${options.limit}`;
};

export const runLeadCollection = async (
  config: AppConfig,
  options: CollectRunOptions,
  sheets?: SheetsClient
): Promise<CollectRunResult> => {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_INITIAL_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_INITIAL_LIMIT}`);
  }

  const openAiConfig = requireOpenAiConfig(config);
  const sheetsClient = sheets ?? (await createSheetsClient(config));
  const existing = await readExistingLeadState(sheetsClient);
  const openAI = createOpenAIClient(openAiConfig);

  const collection = await collectLeadCandidateCollection(openAI, {
    area: options.area,
    targetTypes: options.targetTypes,
    limit: options.limit,
    existingCompanies: existing.companies,
    existingSiteUrls: existing.siteUrls
  });

  const uniqueCandidates = filterUniqueCandidates(collection.candidates, existing);

  return {
    searchTrace: collection.searchTrace,
    candidates: uniqueCandidates
  };
};
