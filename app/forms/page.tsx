"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, ThumbsDown, ThumbsUp } from "lucide-react";

type Sample = {
  id: string;
  leadId: string;
  companyName: string;
  formUrl: string;
  capturedAt: string;
  hasHtml: boolean;
  filled: Array<{ field: string; valueName: string; label: string }>;
  selected: Array<{ label: string; option: string }>;
  warnings: string[];
  confirmStatus: string;
  confirmDetail: string;
  captcha: string;
  status: "pending" | "ok" | "ng";
  note: string;
  reviewedAt: string;
  fixtureName: string;
};

type Stats = { total: number; pending: number; ok: number; ng: number; accuracy: number | null; cleanRate: number | null; advancedRate: number | null };

const VALUE_NAMES: Record<string, string> = {
  companyName: "会社名",
  name: "氏名",
  lastName: "姓",
  firstName: "名",
  nameKana: "氏名カナ",
  nameHiragana: "氏名ひらがな",
  lastNameKana: "姓カナ",
  firstNameKana: "名カナ",
  email: "メール",
  tel: "電話",
  postalCode: "郵便番号",
  prefecture: "都道府県",
  city: "市区町村",
  streetAddress: "番地以降",
  address: "住所",
  cityStreetAddress: "市区町村・番地",
  url: "サイトURL",
  portfolioUrl: "実績URL",
  department: "部署・役職",
  businessDescription: "事業内容",
  specialty: "得意な業務",
  subject: "件名",
  body: "本文",
  age: "年齢"
};

const CONFIRM_LABELS: Record<string, string> = {
  advanced: "確認画面まで進んだ",
  "validation-error": "確認画面に進めなかった",
  "no-confirm-button": "確認ボタンなし",
  skipped: "確認ボタンは押していない",
  unknown: "確認画面の状態は不明"
};

type Filter = "pending" | "ok" | "ng";

export default function FormsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/form-samples", { cache: "no-store" });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }

      setStats(body.stats as Stats);
      setSamples(body.samples as Sample[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込めませんでした");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (sample: Sample, verdict: "ok" | "ng") => {
    if (verdict === "ng" && !(notes[sample.id] ?? "").trim() && !window.confirm("どこが間違いかのメモが空です。このまま「間違いあり」にしますか？")) {
      return;
    }

    setBusyId(sample.id);
    setError("");

    try {
      const res = await fetch("/api/form-samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sample.id, verdict, note: notes[sample.id] ?? "" })
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存できませんでした");
    } finally {
      setBusyId("");
    }
  };

  const shown = (samples ?? []).filter((sample) => sample.status === filter);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <h2>フォーム判定の確認</h2>
          <p>
            自動入力を実行するたびに、フォームの構造と、自動入力の判定が記録されます。判定が合っていたら「正しい」を押すと、テスト用データに加わり、
            以後のプログラム修正で壊れていないかを、自動で確認できます。間違いがあるものは、メモを付けて「間違いあり」にしてください（改善の対象になります）。
          </p>
        </div>
      </div>

      {error && <p className="error-box">{error}</p>}

      {stats && (
        <section className="forms-stats">
          <div className="forms-stat"><span>記録したフォーム</span><strong>{stats.total}</strong></div>
          <div className="forms-stat"><span>確認待ち</span><strong>{stats.pending}</strong></div>
          <div className="forms-stat"><span>判定の正答率（確認済み）</span><strong>{stats.accuracy === null ? "-" : `${stats.accuracy}%`}</strong><small>正しい {stats.ok} / 間違い {stats.ng}</small></div>
          <div className="forms-stat"><span>確認画面まで進めた</span><strong>{stats.advancedRate === null ? "-" : `${stats.advancedRate}%`}</strong></div>
          <div className="forms-stat"><span>警告なしで完結</span><strong>{stats.cleanRate === null ? "-" : `${stats.cleanRate}%`}</strong></div>
        </section>
      )}

      <div className="settings-tabs" role="tablist">
        {(["pending", "ok", "ng"] as const).map((entry) => (
          <button key={entry} type="button" role="tab" aria-selected={filter === entry} className={filter === entry ? "settings-tab active" : "settings-tab"} onClick={() => setFilter(entry)}>
            {entry === "pending" ? "確認待ち" : entry === "ok" ? "正しい（テスト用データに追加済み）" : "間違いあり（改善の対象）"}
            {samples ? `（${samples.filter((sample) => sample.status === entry).length}）` : ""}
          </button>
        ))}
      </div>

      {!samples && !error && <p className="panel-caption">読み込み中...</p>}
      {samples && shown.length === 0 && <p className="panel-caption">この種類の記録は、ありません。</p>}

      <div className="forms-list">
        {shown.map((sample) => (
          <article key={sample.id} className="forms-card">
            <div className="forms-card-head">
              <div>
                <strong>{sample.companyName}</strong>
                <span className="lead-card-sub">{sample.leadId} / {sample.capturedAt.slice(0, 16).replace("T", " ")}</span>
              </div>
              <a className="link-accent" href={sample.formUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} /> フォーム
              </a>
            </div>

            <p className="forms-confirm">
              {CONFIRM_LABELS[sample.confirmStatus] ?? sample.confirmStatus}
              {sample.captcha && ` / CAPTCHA: ${sample.captcha}`}
              {!sample.hasHtml && " / 構造は保存できませんでした（外部のフォームなど）"}
            </p>

            {sample.warnings.length > 0 && (
              <ul className="forms-warnings">
                {sample.warnings.map((warning, index) => (
                  <li key={index}>{warning.slice(0, 160)}</li>
                ))}
              </ul>
            )}

            <table className="forms-fields">
              <thead>
                <tr><th>フォームの項目名</th><th>判定した内容</th></tr>
              </thead>
              <tbody>
                {sample.filled.map((entry, index) => (
                  <tr key={`${entry.field}-${index}`}>
                    <td>{entry.label.slice(0, 40)}</td>
                    <td>{VALUE_NAMES[entry.valueName] ?? entry.valueName}</td>
                  </tr>
                ))}
                {sample.selected.map((entry, index) => (
                  <tr key={`s-${index}`}>
                    <td>{entry.label.slice(0, 40)}</td>
                    <td>選択: {entry.option}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {sample.status === "pending" ? (
              <div className="forms-review">
                <input
                  value={notes[sample.id] ?? ""}
                  placeholder="間違いがあるときは、どこが間違いか（例: 「会社名」欄に氏名が入った）"
                  maxLength={500}
                  onChange={(event) => setNotes({ ...notes, [sample.id]: event.target.value })}
                />
                <button type="button" className="btn primary" disabled={busyId === sample.id} onClick={() => void review(sample, "ok")}>
                  <ThumbsUp size={15} /> {busyId === sample.id ? "処理中..." : "正しい"}
                </button>
                <button type="button" className="btn secondary" disabled={busyId === sample.id} onClick={() => void review(sample, "ng")}>
                  <ThumbsDown size={15} /> 間違いあり
                </button>
              </div>
            ) : (
              <p className="forms-reviewed">
                <Check size={14} /> {sample.status === "ok" ? `テスト用データに追加しました（${sample.fixtureName}）` : `メモ: ${sample.note || "（なし）"}`}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
