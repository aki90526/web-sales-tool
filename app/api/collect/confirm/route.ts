import { NextResponse } from "next/server";
import { buildSearchCondition } from "../../../../src/collection/collectLeadsService";
import { importLeadCandidates } from "../../../../src/collection/leadImport";
import { loadConfig } from "../../../../src/config/env";
import { LeadType } from "../../../../src/domain/lead";
import { createSheetsClient } from "../../../../src/google/sheetsClient";
import { LeadCandidate } from "../../../../src/openai/leadCandidateCollector";
import { WebSearchTrace } from "../../../../src/openai/openAIClient";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      area?: unknown;
      targetTypes?: unknown;
      limit?: unknown;
      searchTrace?: unknown;
      candidates?: unknown;
    };

    if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
      return NextResponse.json({ message: "candidates is required" }, { status: 400 });
    }

    const area = typeof body.area === "string" ? body.area : "";
    const targetTypes = Array.isArray(body.targetTypes) ? (body.targetTypes as LeadType[]) : [];
    const limit = typeof body.limit === "number" ? body.limit : body.candidates.length;
    const candidates = body.candidates as LeadCandidate[];
    const searchTrace = body.searchTrace as WebSearchTrace | undefined;

    const config = loadConfig();
    const sheets = await createSheetsClient(config);

    const results = await importLeadCandidates(sheets, candidates, {
      searchCondition: buildSearchCondition({ area, targetTypes, limit }),
      searchTrace
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
