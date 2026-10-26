"use client";

import { useEffect, useMemo, useState } from "react";
import { History, X } from "lucide-react";

export type LatestLog = { at: string; kind: string; text: string; actor: string } | null;

type LogEntry = { at: string; leadId: string; kind: string; text: string; actor: string; detail: string };

const shortTime = (at: string): string => at.slice(0, 16);

// 一覧・カードで、メモ欄の上に置く部分: 操作者が書く「現在の状況」（1行）、いちばん新しいログ1行、ログを開くボタン
export function LeadLogControls({
  leadId,
  currentNote,
  latestLog,
  onSaveNote,
  onOpenLog
}: {
  leadId: string;
  currentNote: string;
  latestLog: LatestLog;
  onSaveNote: (text: string) => Promise<void>;
  onOpenLog: () => void;
}) {
  const [draft, setDraft] = useState(currentNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 別の画面操作などで、値が変わったときは、入力中でなければ追従する
  useEffect(() => {
    setDraft(currentNote);
  }, [currentNote]);

  const commit = async () => {
    const next = draft.trim();

    if (next === currentNote.trim()) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await onSaveNote(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存できませんでした");
      setDraft(currentNote);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lead-log-controls">
      <div className="lead-log-note-row">
        <input
          className="lead-log-note"
          aria-label={`${leadId} の現在の状況`}
          value={draft}
          maxLength={200}
          disabled={saving}
          placeholder="現在の状況（例: フォーム受付を一時停止中）"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <button type="button" className="btn secondary icon-tiny" onClick={onOpenLog} title="このリードのログを見る" aria-label={`${leadId} のログを見る`}>
          <History size={12} />
        </button>
      </div>
      {error && <p className="lead-log-error">{error}</p>}
      {latestLog && (
        <button type="button" className="lead-log-latest" onClick={onOpenLog} title="クリックでログを開く">
          最新 {shortTime(latestLog.at)} [{latestLog.kind}] {latestLog.text}
        </button>
      )}
    </div>
  );
}

// リードごとのログを、新しい順に表示する
export function LeadLogModal({ leadId, companyName, onClose }: { leadId: string; companyName: string; onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("すべて");

  useEffect(() => {
    let active = true;

    fetch(`/api/leads/log?leadId=${encodeURIComponent(leadId)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();

        if (!res.ok) {
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }

        if (active) {
          setEntries(body.entries as LogEntry[]);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "ログを読み込めませんでした");
        }
      });

    return () => {
      active = false;
    };
  }, [leadId]);

  const kinds = useMemo(() => ["すべて", ...Array.from(new Set((entries ?? []).map((entry) => entry.kind)))], [entries]);
  const shown = (entries ?? []).filter((entry) => kind === "すべて" || entry.kind === kind);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel lead-log-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="panel-title">{companyName}</h3>
            <p className="panel-caption">{leadId} のログ（新しい順）</p>
          </div>
          <button className="btn secondary icon-only" type="button" onClick={onClose} title="閉じる">
            <X size={16} />
          </button>
        </div>

        {entries && entries.length > 0 && (
          <label className="field lead-log-filter">
            種類
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              {kinds.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="error-box">{error}</p>}
        {!entries && !error && <p className="panel-caption">読み込み中...</p>}
        {entries && entries.length === 0 && <p className="panel-caption">ログはまだありません。</p>}

        <ul className="lead-log-list">
          {shown.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <span className="lead-log-time">{shortTime(entry.at)}</span>
              <span className="lead-log-kind">{entry.kind}</span>
              <span className="lead-log-text">
                {entry.text}
                {entry.actor === "手入力" && <em> （手入力）</em>}
                {entry.detail && !entry.detail.startsWith("フォーム指紋") && <small>{entry.detail}</small>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
