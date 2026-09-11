"use client";

import { useEffect, useState } from "react";

const TARGET_TYPES = ["Web制作会社", "広告代理店", "直クライアント"] as const;
type TargetType = (typeof TARGET_TYPES)[number];

type Candidate = {
  companyName: string;
  leadType: string;
  industry: string;
  region: string;
  officialSiteUrl: string;
  salesScore: number;
  status: string;
  salesAngle: string;
};

type CollectResponse = {
  area: string;
  targetTypes: TargetType[];
  limit: number;
  searchTrace: { queries: string[]; sourceUrls: string[] };
  candidates: Candidate[];
};

type ImportResult = {
  leadId: string;
  companyName: string;
  companyNameCorrection?: string;
  contactUrlCorrection?: string;
};

type HistoryEntry = {
  runAt: string;
  area: string;
  targetTypes: TargetType[];
  limit: number;
  resultCount: number;
};

export default function CollectPage() {
  const [area, setArea] = useState("埼玉県春日部市");
  const [targetTypes, setTargetTypes] = useState<TargetType[]>(["Web制作会社", "直クライアント"]);
  const [limit, setLimit] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CollectResponse | null>(null);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const loadHistory = () => {
    fetch("/api/collect/history")
      .then((res) => res.json())
      .then((body) => setHistory(body.history ?? []))
      .catch(() => setHistory([]));
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const toggleTargetType = (type: TargetType) => {
    setTargetTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
    );
  };

  const runCollect = async () => {
    setError(null);
    setImportResults(null);
    setPreview(null);

    if (targetTypes.length === 0) {
      setError("対象種別を1つ以上選択してください");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, targetTypes, limit })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setPreview(body as CollectResponse);
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "収集に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!preview) return;

    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/collect/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview)
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setImportResults(body.results as ImportResult[]);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setImporting(false);
    }
  };

  const applyHistoryEntry = (entry: HistoryEntry) => {
    setArea(entry.area);
    setTargetTypes(entry.targetTypes.length > 0 ? entry.targetTypes : ["Web制作会社"]);
    setLimit(entry.limit);
    setPreview(null);
    setImportResults(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="font-semibold">候補収集</h2>

        <label className="flex flex-col gap-1 text-sm">
          エリア
          <input
            className="rounded border border-[var(--border)] bg-transparent px-2 py-1"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            placeholder="例: 埼玉県春日部市"
          />
        </label>

        <fieldset className="flex flex-col gap-1 text-sm">
          <legend>対象種別</legend>
          <div className="flex flex-wrap gap-3">
            {TARGET_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={targetTypes.includes(type)}
                  onChange={() => toggleTargetType(type)}
                />
                {type}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex max-w-[200px] flex-col gap-1 text-sm">
          件数（上限10件）
          <input
            type="number"
            min={1}
            max={10}
            className="rounded border border-[var(--border)] bg-transparent px-2 py-1"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          />
        </label>

        <p className="text-xs text-[var(--muted)]">
          実行するとOpenAIの検索コストが発生します。まずプレビューを確認してから登録してください。
        </p>

        <button
          className="w-fit rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          onClick={runCollect}
          disabled={loading}
        >
          {loading ? "検索中..." : "候補を検索する"}
        </button>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </section>

      {preview && (
        <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">検索結果プレビュー（{preview.candidates.length}件・未登録）</h2>
            <button
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
              onClick={confirmImport}
              disabled={importing || preview.candidates.length === 0}
            >
              {importing ? "登録中..." : "この内容で登録する"}
            </button>
          </div>

          {preview.candidates.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">新規候補は見つかりませんでした。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left">
                    <th className="px-2 py-1">企業名</th>
                    <th className="px-2 py-1">種別</th>
                    <th className="px-2 py-1">地域</th>
                    <th className="px-2 py-1 text-right">スコア</th>
                    <th className="px-2 py-1">ステータス</th>
                    <th className="px-2 py-1">切り口</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.candidates.map((candidate) => (
                    <tr key={`${candidate.companyName}-${candidate.officialSiteUrl}`} className="border-b border-[var(--border)]">
                      <td className="px-2 py-1">{candidate.companyName}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{candidate.leadType}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{candidate.region}</td>
                      <td className="px-2 py-1 text-right">{candidate.salesScore}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{candidate.status}</td>
                      <td className="px-2 py-1">{candidate.salesAngle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {importResults && (
        <section className="flex flex-col gap-2 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
          <h2 className="font-semibold">登録結果</h2>
          <ul className="list-inside list-disc text-sm">
            {importResults.map((result) => (
              <li key={result.leadId}>
                {result.leadId}: {result.companyName}
                {result.companyNameCorrection && ` （企業名補正: ${result.companyNameCorrection}）`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="font-semibold">最近の検索</h2>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">履歴はまだありません。</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {history.map((entry) => (
              <li key={entry.runAt} className="flex items-center justify-between gap-2">
                <span>
                  {new Date(entry.runAt).toLocaleString("ja-JP")} — {entry.area} / {entry.targetTypes.join(",")} / 上限{entry.limit}件 →{" "}
                  {entry.resultCount}件取得
                </span>
                <button className="shrink-0 text-[var(--accent)] hover:underline" onClick={() => applyHistoryEntry(entry)}>
                  条件を再利用
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
