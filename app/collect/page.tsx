"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, History, RotateCcw, Search, Sparkles } from "lucide-react";

const TARGET_TYPES = ["Web制作会社", "広告代理店", "直クライアント"] as const;
type TargetType = (typeof TARGET_TYPES)[number];

const RECOMMENDED_AREAS = [
  "東京都23区",
  "大阪府大阪市",
  "愛知県名古屋市",
  "福岡県福岡市",
  "北海道札幌市"
] as const;

const TOKYO_WARD_AREAS = [
  "東京都渋谷区 新宿区 港区",
  "東京都千代田区 中央区 港区",
  "東京都品川区 目黒区 世田谷区",
  "東京都豊島区 文京区 台東区",
  "東京都江東区 墨田区 江戸川区"
] as const;

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

  const recentAreas = useMemo(() => {
    return Array.from(new Set(history.map((entry) => entry.area).filter(Boolean))).slice(0, 5);
  }, [history]);

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

  const applyArea = (value: string) => {
    setArea(value);
    setPreview(null);
    setImportResults(null);
  };

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <h2>候補収集</h2>
          <p>エリアと営業先種別を指定して、登録前に候補を確認します。</p>
        </div>
      </div>

      <section className="form-panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">検索条件</h3>
            <p className="panel-caption">検索後、結果プレビューを確認してから営業管理へ登録します。</p>
          </div>
          <span className="kpi-icon"><Sparkles size={18} /></span>
        </div>

        <div className="field-grid">
          <label className="field full">
            エリア
            <input value={area} onChange={(event) => setArea(event.target.value)} placeholder="例: 埼玉県春日部市" />
          </label>

          <div className="area-suggestion-panel">
            <div className="area-suggestion-group">
              <span className="area-suggestion-label">おすすめ</span>
              <div className="area-chip-row">
                {RECOMMENDED_AREAS.map((recommendedArea) => (
                  <button key={recommendedArea} className="area-chip" type="button" onClick={() => applyArea(recommendedArea)}>
                    {recommendedArea}
                  </button>
                ))}
              </div>
            </div>

            <div className="area-suggestion-group">
              <span className="area-suggestion-label">東京区別</span>
              <div className="area-chip-row">
                {TOKYO_WARD_AREAS.map((wardArea) => (
                  <button key={wardArea} className="area-chip" type="button" onClick={() => applyArea(wardArea)}>
                    {wardArea}
                  </button>
                ))}
              </div>
            </div>

            <div className="area-suggestion-group">
              <span className="area-suggestion-label">履歴</span>
              {recentAreas.length === 0 ? (
                <span className="area-empty">まだ履歴はありません</span>
              ) : (
                <div className="area-chip-row">
                  {recentAreas.map((historyArea) => (
                    <button key={historyArea} className="area-chip" type="button" onClick={() => applyArea(historyArea)}>
                      {historyArea}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="field full">
            対象種別
            <div className="check-row target-type-row">
              {TARGET_TYPES.map((type) => (
                <label key={type} className="check-pill target-type-pill">
                  <input type="checkbox" checked={targetTypes.includes(type)} onChange={() => toggleTargetType(type)} />
                  <span>{type}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="field">
            件数
            <input type="number" min={1} max={10} value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
            <span>※ 件数が多いほど検索に時間がかかります。</span>
          </label>
        </div>

        <p className="notice mt-4">実行するとOpenAIの検索コストが発生します。まずプレビューを確認し、必要な候補だけ登録してください。</p>

        <div className="btn-row mt-4">
          <button className="btn primary" onClick={runCollect} disabled={loading}>
            <Search size={16} />
            {loading ? "検索中..." : "候補を検索する"}
          </button>
        </div>

        {error && <p className="error-box mt-4">{error}</p>}
      </section>

      {preview && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">検索結果プレビュー</h3>
              <p className="panel-caption">{preview.candidates.length}件見つかりました。まだ登録されていません。</p>
            </div>
            <button className="btn primary" onClick={confirmImport} disabled={importing || preview.candidates.length === 0}>
              <Database size={16} />
              {importing ? "登録中..." : "この内容で登録する"}
            </button>
          </div>

          {preview.candidates.length === 0 ? (
            <p className="panel-caption">新規候補は見つかりませんでした。</p>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="cell-number cell-nowrap">No.</th>
                    <th>企業名</th>
                    <th className="cell-nowrap">種別</th>
                    <th className="cell-nowrap">地域</th>
                    <th className="cell-nowrap">スコア</th>
                    <th className="cell-nowrap">ステータス</th>
                    <th>切り口</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.candidates.map((candidate, index) => (
                    <tr key={`${candidate.companyName}-${candidate.officialSiteUrl}`}>
                      <td className="cell-number cell-nowrap">{index + 1}</td>
                      <td>{candidate.companyName}</td>
                      <td className="cell-nowrap">{candidate.leadType}</td>
                      <td className="cell-nowrap">{candidate.region}</td>
                      <td className="cell-nowrap"><span className="score-badge">{candidate.salesScore}</span></td>
                      <td className="cell-nowrap"><span className="status-badge">{candidate.status}</span></td>
                      <td>{candidate.salesAngle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {importResults && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">登録結果</h3>
              <p className="panel-caption">営業管理シートへ追加しました。</p>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>リードID</th>
                  <th>企業名</th>
                  <th>補正</th>
                </tr>
              </thead>
              <tbody>
                {importResults.map((result) => (
                  <tr key={result.leadId}>
                    <td>{result.leadId}</td>
                    <td>{result.companyName}</td>
                    <td>{result.companyNameCorrection || result.contactUrlCorrection || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">最近の検索</h3>
            <p className="panel-caption">条件を再利用できます。</p>
          </div>
          <History size={18} color="var(--muted)" />
        </div>
        {history.length === 0 ? (
          <p className="panel-caption">履歴はまだありません。</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>条件</th>
                  <th>結果</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.runAt}>
                    <td>{new Date(entry.runAt).toLocaleString("ja-JP")}</td>
                    <td>{entry.area} / {entry.targetTypes.join(",")} / 上限{entry.limit}件</td>
                    <td>{entry.resultCount}件</td>
                    <td>
                      <button className="btn secondary" onClick={() => applyHistoryEntry(entry)}>
                        <RotateCcw size={15} />
                        再利用
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
