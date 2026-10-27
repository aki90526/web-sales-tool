"use client";

import { useEffect, useMemo, useState } from "react";
import { History, X } from "lucide-react";

export type LatestLog = { at: string; kind: string; text: string; actor: string } | null;

type LogEntry = { at: string; leadId: string; kind: string; text: string; actor: string; detail: string; rowNumber?: number };

const NOTE_PREFIX = "状況を更新: ";

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

  const dirty = draft.trim() !== currentNote.trim();

  // 保存は、「保存」ボタンを押したときだけ行う（日本語の変換中のEnterや、入力欄から離れただけでは、保存しない）
  const commit = async () => {
    if (!dirty || saving) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await onSaveNote(draft.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lead-log-controls">
      <div className="lead-log-note-row">
        <input
          className={dirty ? "lead-log-note dirty" : "lead-log-note"}
          aria-label={`${leadId} の現在の状況`}
          value={draft}
          maxLength={200}
          disabled={saving}
          placeholder="現在の状況（例: フォーム受付を一時停止中）"
          onChange={(event) => setDraft(event.target.value)}
        />
        {dirty && (
          <>
            <button type="button" className="btn primary lead-log-save" disabled={saving} onClick={() => void commit()}>
              {saving ? "保存中" : "保存"}
            </button>
            <button type="button" className="btn secondary lead-log-save" disabled={saving} onClick={() => setDraft(currentNote)}>
              戻す
            </button>
          </>
        )}
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
export function LeadLogModal({
  leadId,
  companyName,
  onClose,
  onChanged
}: {
  leadId: string;
  companyName: string;
  onClose: () => void;
  // ログを直した・消したあとに呼ぶ（一覧の表示を更新するため）
  onChanged?: () => void;
}) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("すべて");
  // 編集中の行（シート上の行番号）と、入力中の内容
  const [editing, setEditing] = useState<{ rowNumber: number; draft: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // 手で書いた「状況」のログを、直す・消す。システムが書いたログは、変更できない
  const changeEntry = async (entry: LogEntry, action: { text: string } | { remove: true }) => {
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/leads/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, rowNumber: entry.rowNumber, at: entry.at, ...("remove" in action ? { delete: true } : { text: action.text }) })
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }

      setEntries(body.entries as LogEntry[]);
      setEditing(null);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "変更できませんでした");
    } finally {
      setBusy(false);
    }
  };

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
                {editing && editing.rowNumber === entry.rowNumber ? (
                  <span className="lead-log-edit">
                    <input
                      value={editing.draft}
                      maxLength={200}
                      disabled={busy}
                      onChange={(event) => setEditing({ rowNumber: editing.rowNumber, draft: event.target.value })}
                    />
                    <button
                      type="button"
                      className="btn primary lead-log-save"
                      disabled={busy || !editing.draft.trim()}
                      onClick={() => void changeEntry(entry, { text: editing.draft })}
                    >
                      保存
                    </button>
                    <button type="button" className="btn secondary lead-log-save" disabled={busy} onClick={() => setEditing(null)}>
                      キャンセル
                    </button>
                  </span>
                ) : (
                  <>
                    {entry.text}
                    {entry.actor === "手入力" && <em> （手入力）</em>}
                    {entry.detail && !entry.detail.startsWith("フォーム指紋") && <small>{entry.detail}</small>}
                    {entry.kind === "状況" && entry.actor === "手入力" && entry.rowNumber && (
                      <span className="lead-log-actions">
                        {entry.text.startsWith(NOTE_PREFIX) && (
                          <button
                            type="button"
                            className="link-accent"
                            disabled={busy}
                            onClick={() => setEditing({ rowNumber: entry.rowNumber as number, draft: entry.text.slice(NOTE_PREFIX.length) })}
                          >
                            編集
                          </button>
                        )}
                        <button
                          type="button"
                          className="link-accent"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm("このログを削除します。よろしいですか？")) {
                              void changeEntry(entry, { remove: true });
                            }
                          }}
                        >
                          削除
                        </button>
                      </span>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
