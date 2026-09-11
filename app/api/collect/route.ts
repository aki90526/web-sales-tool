import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { MAX_INITIAL_LIMIT, runLeadCollection } from "../../../src/collection/collectLeadsService";
import { loadConfig } from "../../../src/config/env";
import { LEAD_TYPES, LeadType } from "../../../src/domain/lead";

const HISTORY_PATH = path.resolve(process.cwd(), "data", "collect-history.json");
const MAX_HISTORY_ENTRIES = 30;

type HistoryEntry = {
  runAt: string;
  area: string;
  targetTypes: LeadType[];
  limit: number;
  resultCount: number;
};

const appendHistory = async (entry: HistoryEntry): Promise<void> => {
  let entries: HistoryEntry[] = [];

  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      entries = parsed as HistoryEntry[];
    }
  } catch {
    entries = [];
  }

  entries.unshift(entry);
  entries = entries.slice(0, MAX_HISTORY_ENTRIES);

  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
};

const parseTargetTypes = (value: unknown): LeadType[] => {
  if (!Array.isArray(value)) {
    throw new Error("targetTypes must be an array");
  }

  const types = value.filter((item): item is LeadType => LEAD_TYPES.includes(item as LeadType));

  if (types.length === 0) {
    throw new Error(`targetTypes must include at least one of: ${LEAD_TYPES.join(", ")}`);
  }

  return types;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      area?: unknown;
      targetTypes?: unknown;
      limit?: unknown;
    };

    const area = typeof body.area === "string" && body.area.trim() ? body.area.trim() : "埼玉県春日部市";
    const targetTypes = parseTargetTypes(body.targetTypes ?? ["Web制作会社", "直クライアント"]);
    const limit = Number(body.limit ?? 5);

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INITIAL_LIMIT) {
      return NextResponse.json(
        { message: `limitは1〜${MAX_INITIAL_LIMIT}の整数で指定してください` },
        { status: 400 }
      );
    }

    const config = loadConfig();
    const result = await runLeadCollection(config, { area, targetTypes, limit });

    await appendHistory({
      runAt: new Date().toISOString(),
      area,
      targetTypes,
      limit,
      resultCount: result.candidates.length
    });

    return NextResponse.json({
      area,
      targetTypes,
      limit,
      searchTrace: result.searchTrace,
      candidates: result.candidates
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
