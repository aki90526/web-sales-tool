import { NextResponse } from "next/server";
import { FormOutcome, FormOutcomeKind, readFormOutcomes } from "../../../src/form/formOutcomeLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PERIOD_DAYS = 30;

// フォーム送信の結果（直近30日）の集計: 結果の種類ごとの件数、問題が多いサイト、最近の問題
export async function GET() {
  const since = Date.now() - PERIOD_DAYS * 24 * 60 * 60 * 1000;
  const entries = readFormOutcomes().filter((entry) => new Date(entry.at).getTime() >= since);
  const counts: Partial<Record<FormOutcomeKind, number>> = {};

  entries.forEach((entry) => {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  });

  const problemKinds: FormOutcomeKind[] = ["spam", "invalid", "failed", "captcha", "wrong-page"];
  const problems = entries.filter((entry) => problemKinds.includes(entry.kind));
  const byDomain = new Map<string, number>();

  problems.forEach((entry) => {
    if (entry.domain) {
      byDomain.set(entry.domain, (byDomain.get(entry.domain) ?? 0) + 1);
    }
  });

  const recentProblems: FormOutcome[] = [...problems].reverse().slice(0, 10);

  return NextResponse.json({
    periodDays: PERIOD_DAYS,
    total: entries.length,
    counts,
    topProblemDomains: Array.from(byDomain.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count })),
    recentProblems
  });
}
