import { promises as fs } from "fs";
import path from "path";
import { LeadType, LEAD_TYPES } from "../domain/lead";
import { LeadCandidate, normalizeLeadCandidate } from "../openai/leadCandidateCollector";
import { WebSearchTrace } from "../openai/openAIClient";

export const DEFAULT_PREVIEW_PATH = path.resolve(process.cwd(), "tmp", "collect-preview.json");

export type CollectPreview = {
  generatedAt: string;
  area: string;
  targetTypes: LeadType[];
  limit: number;
  searchTrace?: WebSearchTrace;
  candidates: LeadCandidate[];
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const normalizeTargetTypes = (value: unknown): LeadType[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is LeadType => {
    return LEAD_TYPES.includes(item as LeadType);
  });
};

export const saveCollectPreview = async (
  preview: CollectPreview,
  filePath = DEFAULT_PREVIEW_PATH
): Promise<string> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(preview, null, 2)}\n`, "utf8");

  return filePath;
};

export const loadCollectPreview = async (
  filePath = DEFAULT_PREVIEW_PATH
): Promise<CollectPreview> => {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isObject(parsed)) {
    throw new Error(`Invalid preview file: ${filePath}`);
  }

  const rawCandidates = parsed.candidates;

  if (!Array.isArray(rawCandidates)) {
    throw new Error(`Preview file does not contain candidates: ${filePath}`);
  }

  const candidates = rawCandidates
    .map(normalizeLeadCandidate)
    .filter((candidate): candidate is LeadCandidate => candidate !== null);

  if (candidates.length === 0) {
    throw new Error(`Preview file does not contain valid candidates: ${filePath}`);
  }

  return {
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
    area: typeof parsed.area === "string" ? parsed.area : "",
    targetTypes: normalizeTargetTypes(parsed.targetTypes),
    limit: typeof parsed.limit === "number" ? parsed.limit : candidates.length,
    searchTrace: isObject(parsed.searchTrace)
      ? {
          queries: Array.isArray(parsed.searchTrace.queries)
            ? parsed.searchTrace.queries.filter((value): value is string => typeof value === "string")
            : [],
          sourceUrls: Array.isArray(parsed.searchTrace.sourceUrls)
            ? parsed.searchTrace.sourceUrls.filter((value): value is string => typeof value === "string")
            : []
        }
      : undefined,
    candidates
  };
};
