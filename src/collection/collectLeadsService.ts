import { AppConfig, requireOpenAiConfig } from "../config/env";
import { LeadType } from "../domain/lead";
import { createSheetsClient, SheetsClient } from "../google/sheetsClient";
import { collectLeadCandidateCollection, isInSearchArea, LeadCandidate } from "../openai/leadCandidateCollector";
import { createOpenAIClient, WebSearchTrace } from "../openai/openAIClient";
import { filterUniqueCandidates, formatTargetTypes, readExistingLeadState } from "./leadImport";

export const MAX_INITIAL_LIMIT = 10;

export type CollectRunOptions = {
  area: string;
  autoRejectLowScore?: boolean;
  excludeArea?: string;
  targetTypes: LeadType[];
  limit: number;
};

export type CollectRunResult = {
  searchTrace: WebSearchTrace;
  candidates: LeadCandidate[];
};

export const buildSearchCondition = (options: CollectRunOptions): string => {
  const exclude = options.excludeArea ? ` / 除外地域: ${options.excludeArea}` : "";

  return `地域: ${options.area}${exclude} / 対象: ${formatTargetTypes(options.targetTypes)} / 最大件数: ${options.limit}`;
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
  // AIに渡す除外リストは、「検索するエリアに登録済みの会社」と「『除外リスト』シートの会社（エリアは問わない）」にする。
  // 全件を渡すと長くなり、無関係な会社も混ざるため。重複の判定は、このあとの filterUniqueCandidates が、登録済みの全件と除外リストに対して行う
  const inArea = existing.entries.filter((entry) => entry.source === "lead" && isInSearchArea(entry.region, options.area));
  const exclusionList = existing.entries.filter((entry) => entry.source === "exclusionList");
  // 除外リストの会社は、リストの末尾に置く（長いリストが切られるときも、残るように）
  const scoped = Array.from(new Map([...inArea, ...exclusionList].map((entry) => [`${entry.company}|${entry.url}`, entry])).values());

  const collection = await collectLeadCandidateCollection(openAI, {
    area: options.area,
    autoRejectLowScore: options.autoRejectLowScore,
    excludeArea: options.excludeArea,
    targetTypes: options.targetTypes,
    limit: options.limit,
    existingCompanies: scoped.map((entry) => entry.company).filter(Boolean),
    existingSiteUrls: scoped.map((entry) => entry.url).filter(Boolean)
  });

  const uniqueCandidates = filterUniqueCandidates(collection.candidates, existing);

  return {
    searchTrace: collection.searchTrace,
    candidates: uniqueCandidates
  };
};
