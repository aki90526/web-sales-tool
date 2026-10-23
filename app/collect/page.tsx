"use client";

import { useEffect, useMemo, useState } from "react";
import AreaPicker from "./AreaPicker";
import { Check, Database, Pencil, X, Eye, History, RotateCcw, Search, Sparkles } from "lucide-react";

// 登録するときに選べるステータス（送信済み以降は、登録の時点では選ばない）
const REGISTER_STATUSES = ["送信待ち", "未確認", "確認済み", "保留", "見送り", "除外"] as const;

const TARGET_TYPES = ["Web制作会社", "広告代理店", "直クライアント"] as const;
type TargetType = (typeof TARGET_TYPES)[number];

const RECOMMENDED_AREAS = [
  "埼玉県春日部市",
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
  contactUrl: string;
  email: string;
  salesScore: number;
  status: string;
  salesAngle: string;
  // AIの所見メモと、点数が「除外」になった理由（営業お断りの記載など）
  memo?: string;
  exclusionReason?: string;
  recommendedApproach?: string;
};

const contactMethodLabel = (candidate: Candidate): string => {
  if (candidate.email) return "メール";
  if (candidate.contactUrl) return "フォーム";
  return "未定";
};

const contactMethodClass = (candidate: Candidate): string => {
  if (candidate.email) return "method-badge email";
  if (candidate.contactUrl) return "method-badge form";
  return "method-badge";
};

type CollectResponse = {
  area: string;
  excludeArea?: string;
  autoRejectLowScore?: boolean;
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
  emailFound?: string;
  contactUrlWarning?: string;
};

type HistoryEntry = {
  id?: string;
  runAt: string;
  area: string;
  excludeArea?: string;
  targetTypes: TargetType[];
  limit: number;
  resultCount: number;
  candidates?: Candidate[];
  searchTrace?: { queries: string[]; sourceUrls: string[] };
};

export default function CollectPage() {
  const [area, setArea] = useState("埼玉県春日部市");
  const [excludeArea, setExcludeArea] = useState("");
  const [autoRejectLowScore, setAutoRejectLowScore] = useState(false);
  const [targetTypes, setTargetTypes] = useState<TargetType[]>(["Web制作会社", "広告代理店"]);
  const [limit, setLimit] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CollectResponse | null>(null);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // プレビューのうち、登録する候補（番号）。新しいプレビューが出るたびに、全件が選ばれた状態に戻す
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  // メモを全文表示している候補（普段は4行まで）
  const [expandedMemos, setExpandedMemos] = useState<number[]>([]);
  // フォームURLをその場で追加・変更している候補（番号と入力中のURL）
  const [editingContact, setEditingContact] = useState<{ index: number; draft: string; error: string } | null>(null);

  useEffect(() => {
    setSelectedIndexes(preview ? preview.candidates.map((_, index) => index) : []);
    setExpandedMemos([]);
    setEditingContact(null);
  }, [preview]);

  const toggleCandidate = (index: number) => {
    setSelectedIndexes((current) =>
      current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index].sort((a, b) => a - b)
    );
  };
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

    setModalOpen(true);
    setLoading(true);
    try {
      const res = await fetch("/api/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, excludeArea, autoRejectLowScore, targetTypes, limit })
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
    if (!preview || selectedIndexes.length === 0) return;

    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/collect/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...preview,
          candidates: preview.candidates.filter((_, index) => selectedIndexes.includes(index))
        })
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

  const closeModal = () => {
    if (loading || importing) return;
    setModalOpen(false);
    setPreview(null);
    setImportResults(null);
    setError(null);
  };

  const applyHistoryEntry = (entry: HistoryEntry) => {
    setArea(entry.area);
    setExcludeArea(entry.excludeArea ?? "");
    setTargetTypes(entry.targetTypes.length > 0 ? entry.targetTypes : ["Web制作会社"]);
    setLimit(entry.limit);
    setPreview(null);
    setImportResults(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loadCandidatesFromHistory = (entry: HistoryEntry) => {
    if (!entry.candidates || entry.candidates.length === 0) return;

    setError(null);
    setImportResults(null);
    setPreview({
      area: entry.area,
      excludeArea: entry.excludeArea,
      targetTypes: entry.targetTypes,
      limit: entry.limit,
      searchTrace: entry.searchTrace ?? { queries: [], sourceUrls: [] },
      candidates: entry.candidates
    });
    setModalOpen(true);
  };

  // 候補のステータスを、登録前に変える。登録するときは、この内容が使われる
  const changeCandidateStatus = (index: number, status: string) => {
    if (!preview) return;

    setPreview({
      ...preview,
      candidates: preview.candidates.map((candidate, candidateIndex) =>
        candidateIndex === index && candidate.status !== status
          ? {
              ...candidate,
              status,
              memo: [candidate.memo, `ステータスを登録前に手動で変更: ${candidate.status} → ${status}`].filter(Boolean).join("\n")
            }
          : candidate
      )
    });
  };

  // 候補のフォームURLを、プレビューの時点で追加・変更する。登録するときは、この内容が使われる。
  // 「連絡先なし」で見送りになっていた候補は、AIの見送り判断や除外理由が無ければ、送信待ちに戻す
  const saveContactUrl = (index: number) => {
    if (!editingContact || !preview) return;
    const url = editingContact.draft.trim();

    if (!/^https?:\/\/\S+$/i.test(url)) {
      setEditingContact({ ...editingContact, error: "http:// または https:// で始まるURLを入力してください" });
      return;
    }

    setPreview({
      ...preview,
      candidates: preview.candidates.map((candidate, candidateIndex) => {
        if (candidateIndex !== index) return candidate;

        const revive =
          candidate.status === "見送り" && candidate.recommendedApproach !== "見送り" && !candidate.exclusionReason && !candidate.contactUrl && !candidate.email;

        return {
          ...candidate,
          contactUrl: url,
          status: revive ? "送信待ち" : candidate.status,
          memo: [candidate.memo, `フォームURLを手動で追加: ${url}`].filter(Boolean).join("\n")
        };
      })
    });
    setEditingContact(null);
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

          <label className="field full">
            除外エリア（任意）
            <input
              value={excludeArea}
              onChange={(event) => setExcludeArea(event.target.value)}
              placeholder="例: 東京都（複数はカンマ区切り）"
            />
          </label>

          <AreaPicker onChange={applyArea} />

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

          <div className="field full">
            スコアによる自動見送り
            <div className="check-row target-type-row">
              <label className="check-pill target-type-pill">
                <input
                  type="checkbox"
                  checked={autoRejectLowScore}
                  onChange={(event) => setAutoRejectLowScore(event.target.checked)}
                />
                <span>{autoRejectLowScore ? "ON" : "OFF"}</span>
              </label>
            </div>
            <span>
              {autoRejectLowScore
                ? "※ 営業スコアが低い候補は「見送り」で登録します。"
                : "※ スコアが低くても「送信待ち」で登録します（連絡先なし・AI判断の見送りは対象外）。"}
            </span>
          </div>

          <label className="field">
            件数
            <input type="number" min={1} max={10} value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
            <span>※ 件数が多いほど検索に時間がかかります。</span>
          </label>
        </div>

        <p className="notice mt-4">検索を実行すると、その時点でOpenAIの検索コストが発生します（登録する件数では変わりません）。結果は登録前にプレビューで確認でき、「最近の検索」から再検索せずに呼び出せます。</p>

        <div className="btn-row mt-4">
          <button className="btn primary" onClick={runCollect} disabled={loading}>
            <Search size={16} />
            {loading ? "検索中..." : "候補を検索する"}
          </button>
        </div>

        {error && !modalOpen && <p className="error-box mt-4">{error}</p>}
      </section>

      {modalOpen && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-panel modal-wide modal-preview" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="panel-title">
                  {importResults ? "登録結果" : loading ? "検索中" : importing ? "登録中" : "検索結果プレビュー"}
                </h3>
                <p className="panel-caption">
                  {importResults
                    ? "営業管理シートへ追加しました。"
                    : loading
                      ? "OpenAIで候補を検索しています。数分かかることがあります。"
                      : importing
                        ? "営業管理シートへ登録しています。"
                        : preview
                          ? `${preview.candidates.length}件見つかりました。登録する候補を選んでください（まだ登録されていません）。`
                          : ""}
                </p>
              </div>
              <div className="btn-row-tight">
                {preview && !importResults && (
                  <button className="btn primary" onClick={confirmImport} disabled={importing || selectedIndexes.length === 0}>
                    <Database size={16} />
                    {importing ? "登録中..." : `選んだ${selectedIndexes.length}件を登録する`}
                  </button>
                )}
                <button className="btn secondary" type="button" onClick={closeModal} disabled={loading || importing}>
                  閉じる
                </button>
              </div>
            </div>

            {(loading || importing) && (
              <div className="modal-loading">
                <span className="loading-spinner" />
                <span>{loading ? "検索中です..." : "登録中です..."}</span>
              </div>
            )}

            {error && !loading && !importing && <p className="error-box">{error}</p>}

      {!loading && !importing && preview && !importResults && (
        <>
          {preview.candidates.length === 0 ? (
            <p className="panel-caption">新規候補は見つかりませんでした。</p>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="cell-nowrap">
                      <input
                        type="checkbox"
                        aria-label="すべて選択"
                        checked={selectedIndexes.length === preview.candidates.length}
                        onChange={(event) =>
                          setSelectedIndexes(event.target.checked ? preview.candidates.map((_, index) => index) : [])
                        }
                      />
                    </th>
                    <th className="cell-number cell-nowrap hide-mobile">No.</th>
                    <th className="col-preview-company">企業名</th>
                    <th className="cell-nowrap hide-mobile">種別</th>
                    <th className="cell-nowrap hide-mobile">地域</th>
                    <th className="cell-nowrap">連絡方法</th>
                    <th className="cell-nowrap">スコア</th>
                    <th className="cell-nowrap">ステータス</th>
                    <th className="hide-mobile col-preview-angle">切り口</th>
                    <th className="hide-mobile col-preview-memo">メモ・除外理由</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.candidates.map((candidate, index) => (
                    <tr
                      key={`${candidate.companyName}-${candidate.officialSiteUrl}`}
                      style={selectedIndexes.includes(index) ? undefined : { opacity: 0.45 }}
                    >
                      <td className="cell-nowrap">
                        <input
                          type="checkbox"
                          aria-label={`${candidate.companyName}を登録する`}
                          checked={selectedIndexes.includes(index)}
                          onChange={() => toggleCandidate(index)}
                        />
                      </td>
                      <td className="cell-number cell-nowrap hide-mobile">{index + 1}</td>
                      <td className="col-preview-company">
                        {candidate.officialSiteUrl ? (
                          <a className="link-accent" href={candidate.officialSiteUrl} target="_blank" rel="noreferrer" title={candidate.officialSiteUrl}>
                            {candidate.companyName}
                          </a>
                        ) : (
                          candidate.companyName
                        )}
                      </td>
                      <td className="cell-nowrap hide-mobile">{candidate.leadType}</td>
                      <td className="cell-nowrap hide-mobile">{candidate.region}</td>
                      <td className="cell-nowrap">
                        {(() => {
                          // 鉛筆は、フォームURLの追加・変更用。フォームのバッジがあれば、その横に、無ければ、1つだけのバッジの横に置く
                          const pencil = (
                            <button
                              type="button"
                              className="btn secondary icon-tiny"
                              title={candidate.contactUrl ? `フォームURLを変更（${candidate.contactUrl}）` : "フォームURLを追加"}
                              onClick={() => setEditingContact({ index, draft: candidate.contactUrl || "", error: "" })}
                            >
                              <Pencil size={11} />
                            </button>
                          );

                          return (
                            <div className="method-stack">
                              {candidate.email && (
                                <span className="method-line">
                                  <span className={contactMethodClass(candidate)} title={candidate.email}>
                                    メール
                                  </span>
                                  {!candidate.contactUrl && pencil}
                                </span>
                              )}
                              {candidate.contactUrl && (
                                <span className="method-line">
                                  <a className="method-badge form" href={candidate.contactUrl} target="_blank" rel="noreferrer" title={candidate.contactUrl}>
                                    フォーム
                                  </a>
                                  {pencil}
                                </span>
                              )}
                              {!candidate.email && !candidate.contactUrl && (
                                <span className="method-line">
                                  <span className={contactMethodClass(candidate)}>{contactMethodLabel(candidate)}</span>
                                  {pencil}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        {editingContact?.index === index && (
                          <div className="url-edit">
                            <input
                              value={editingContact.draft}
                              autoFocus
                              onChange={(event) => setEditingContact({ ...editingContact, draft: event.target.value, error: "" })}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") saveContactUrl(index);
                                if (event.key === "Escape") setEditingContact(null);
                              }}
                              placeholder="https://example.com/contact/"
                              aria-label={`${candidate.companyName} のフォームURL`}
                            />
                            <button type="button" className="btn primary icon-only" onClick={() => saveContactUrl(index)} title="保存">
                              <Check size={14} />
                            </button>
                            <button type="button" className="btn secondary icon-only" onClick={() => setEditingContact(null)} title="キャンセル">
                              <X size={14} />
                            </button>
                            {editingContact.error && <p className="url-edit-error">{editingContact.error}</p>}
                          </div>
                        )}
                      </td>
                      <td className="cell-nowrap"><span className="score-badge">{candidate.salesScore}</span></td>
                      <td className="cell-nowrap">
                        <select
                          className="status-badge status-select"
                          aria-label={`${candidate.companyName} のステータス`}
                          value={REGISTER_STATUSES.includes(candidate.status as (typeof REGISTER_STATUSES)[number]) ? candidate.status : ""}
                          onChange={(event) => changeCandidateStatus(index, event.target.value)}
                        >
                          {!REGISTER_STATUSES.includes(candidate.status as (typeof REGISTER_STATUSES)[number]) && (
                            <option value="">{candidate.status || "未設定"}</option>
                          )}
                          {REGISTER_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="hide-mobile col-preview-angle">{candidate.salesAngle}</td>
                      <td className="hide-mobile col-preview-memo">
                        {candidate.exclusionReason && <p className="preview-exclusion">除外理由: {candidate.exclusionReason}</p>}
                        {candidate.memo ? (
                          <>
                            <div className={expandedMemos.includes(index) ? undefined : "clamp-4"}>{candidate.memo}</div>
                            {candidate.memo.length > 90 && (
                              <button
                                type="button"
                                className="link-button"
                                onClick={() =>
                                  setExpandedMemos((current) => (current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index]))
                                }
                              >
                                {expandedMemos.includes(index) ? "閉じる" : "全文を見る"}
                              </button>
                            )}
                          </>
                        ) : (
                          !candidate.exclusionReason && <span className="panel-caption">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!importing && importResults && (
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
                    <td className="cell-nowrap">
                      <a className="link-accent" href={`/leads?leadId=${encodeURIComponent(result.leadId)}`} target="_blank" rel="noreferrer" title="リード一覧で開く（別タブ）">
                        {result.leadId}
                      </a>
                    </td>
                    <td>
                      <a className="link-accent" href={`/leads?leadId=${encodeURIComponent(result.leadId)}`} target="_blank" rel="noreferrer" title="リード一覧で開く（別タブ）">
                        {result.companyName}
                      </a>
                    </td>
                    <td>{result.companyNameCorrection || result.contactUrlCorrection || (result.emailFound ? `メール取得: ${result.emailFound}` : "-")}
                      {result.contactUrlWarning ? ` ⚠ ${result.contactUrlWarning}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      )}
          </div>
        </div>
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
          <div className="history-list">
            {history.map((entry) => {
              const hasCandidates = Boolean(entry.candidates && entry.candidates.length > 0);

              return (
                <div className="history-item" key={entry.id ?? entry.runAt}>
                  <div className="history-item-info">
                    <span className="history-item-date">{new Date(entry.runAt).toLocaleString("ja-JP")}</span>
                    <span className="history-item-condition">
                      {entry.area}
                      {entry.excludeArea ? `（${entry.excludeArea}を除く）` : ""} / {entry.targetTypes.join(",")} / 上限{entry.limit}件
                    </span>
                    <span className="history-item-result">{entry.resultCount}件取得</span>
                  </div>
                  <div className="history-item-actions">
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => loadCandidatesFromHistory(entry)}
                      disabled={!hasCandidates}
                      title={hasCandidates ? "再検索せずに前回の候補を表示します" : "候補データが保存されていません"}
                    >
                      <Eye size={15} />
                      候補を呼び出す
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => applyHistoryEntry(entry)}
                      title="条件をフォームに反映します（再検索が必要です）"
                    >
                      <RotateCcw size={15} />
                      条件だけ再利用
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
