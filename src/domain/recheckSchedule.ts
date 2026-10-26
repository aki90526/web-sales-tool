// 見送りの再確認の日程。サーバーと画面の両方から使うため、他のモジュールに依存しない

const RECHECK_LINE_PREFIX = "見送りの再確認:";

// 最後に確認した日、または見送りにした日（メモの記録）のうち、新しい方。記録がなければ空（すぐ確認する）
export const lastCheckedDate = (memo: string): string => {
  const dates = memo
    .split("\n")
    .filter((line) => line.startsWith(RECHECK_LINE_PREFIX) || /^ステータス変更: .* → 見送り \(\d{4}-\d{2}-\d{2}/.test(line))
    .map((line) => /(\d{4}-\d{2}-\d{2})/.exec(line)?.[1] ?? "");

  return dates.sort().pop() ?? "";
};

export const addDays = (dateText: string, days: number): string => {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

export type NextRecheck = { kind: "never" } | { kind: "pending" } | { kind: "date"; date: string };

// 次の再確認の日。リードごとの日数（空欄は既定の日数、「なし」は再確認しない）と、メモの記録から求める。
// 記録が無いリードは、次の自動処理で確認される（pending）
export const nextRecheck = (memo: string, recheckDays: string, defaultDays: number, baseDate = ""): NextRecheck => {
  const value = recheckDays.trim();

  if (value === "なし") {
    return { kind: "never" };
  }

  const parsed = Number(value);
  const days = value && Number.isInteger(parsed) && parsed > 0 ? parsed : defaultDays;
  const fromMemo = lastCheckedDate(memo);
  const last = baseDate > fromMemo ? baseDate : fromMemo;

  return last ? { kind: "date", date: addDays(last, days) } : { kind: "pending" };
};

export const nextRecheckLabel = (memo: string, recheckDays: string, defaultDays: number, baseDate = ""): string => {
  const next = nextRecheck(memo, recheckDays, defaultDays, baseDate);

  if (next.kind === "never") return "再確認しない";
  if (next.kind === "pending") return "再確認 まもなく";
  return `再確認 ${next.date}`;
};
