"use client";

import { LeadLogControls, type LatestLog } from "../components/LeadLog";
import { useState } from "react";
import { Check, ExternalLink, Mail, MessageSquare, Pencil, X } from "lucide-react";
import ActionMenu, { type ActionMenuItem } from "../leads/ActionMenu";

export type Candidate = {
  leadId: string;
  companyName: string;
  leadType: string;
  region: string;
  officialSiteUrl: string;
  contactMethod: string;
  contactFormUrl: string;
  emailAddress: string;
  salesScore: number;
  status: string;
  memo: string;
  nextActionDate: string;
  currentNote?: string;
  latestLog?: LatestLog;
};

type CandidatePanelProps = {
  tab: "email" | "form";
  candidates: Candidate[] | null;
  selectedIds: string[];
  maxSelect: number;
  notice: string | null;
  error: string | null;
  onToggle: (leadId: string) => void;
  onMemoSave: (lead: Candidate, memo: string) => void;
  onSaveNote: (lead: Candidate, text: string) => Promise<void>;
  onOpenLog: (lead: Candidate) => void;
  onStatusChange: (lead: Candidate, status: string) => void;
  onShowMessage: (lead: Candidate) => void;
  // フォームURLを保存する（失敗したら、エラーを投げる）
  onFormUrlChange: (lead: Candidate, url: string) => Promise<void>;
};

const CHANGE_STATUSES = ["見送り", "保留", "除外", "商談中", "面談済み", "返信あり"] as const;

// メモ欄の高さを内容に合わせる（普段は最大3行まで。編集中は全文を表示する。上限はCSS側）
const autoResize = (element: HTMLTextAreaElement | null): void => {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
};

export const isManualOnly = (lead: Candidate): boolean => lead.contactMethod === "フォーム" && lead.memo.includes("[CAPTCHA]");

// 実行の対象にできるリード（送信待ち）を、カードで一覧表示する。チェックしたリードが、実行の対象になる
export default function CandidatePanel(props: CandidatePanelProps) {
  const { candidates, selectedIds, maxSelect } = props;
  const selected = new Set(selectedIds);
  // フォームURLを編集中のリード
  const [editing, setEditing] = useState<{ leadId: string; draft: string; error: string; saving: boolean } | null>(null);

  const saveUrl = async (lead: Candidate) => {
    if (!editing) return;
    const url = editing.draft.trim();

    if (!/^https?:\/\/\S+$/i.test(url)) {
      setEditing({ ...editing, error: "http:// または https:// で始まるURLを入力してください" });
      return;
    }

    if (url === lead.contactFormUrl) {
      setEditing(null);
      return;
    }

    setEditing({ ...editing, saving: true, error: "" });
    try {
      await props.onFormUrlChange(lead, url);
      setEditing(null);
    } catch (err) {
      setEditing({ ...editing, saving: false, error: err instanceof Error ? err.message : "保存に失敗しました" });
    }
  };

  return (
    <aside className="candidate-panel form-panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">候補リード</h3>
          <p className="panel-caption">
            {props.tab === "email"
              ? "メールの送信待ちを、スコアの高い順に表示しています。"
              : "フォームの送信待ちを、自動入力できるものを上、手動のみ（CAPTCHAあり）を下に、それぞれスコアの高い順に表示しています。"}
            チェックしたリードが、実行の対象になります（選択 {selectedIds.length}件 / 最大{maxSelect}件）。
          </p>
        </div>
      </div>

      {props.error && <p className="error-box">{props.error}</p>}
      {props.notice && !props.error && <p className="success-box">{props.notice}</p>}
      {candidates === null && <p className="panel-caption">読み込み中...</p>}
      {candidates && candidates.length === 0 && <p className="panel-caption">送信待ちのリードはありません。</p>}

      <div className="candidate-list">
        {candidates?.map((lead) => {
          const checked = selected.has(lead.leadId);
          const full = !checked && selectedIds.length >= maxSelect;
          const manualOnly = isManualOnly(lead);
          const menuItems: ActionMenuItem[] = CHANGE_STATUSES.map((status) => ({
            key: status,
            label: `${status}にする`,
            icon: null,
            onClick: () => props.onStatusChange(lead, status)
          }));

          return (
            <article key={lead.leadId} className={`lead-card candidate-card${checked ? " selected" : ""}`}>
              <div className="lead-card-head">
                <label className="candidate-check" title={full ? `一度に選べるのは${maxSelect}件までです` : "このリードを実行の対象にする"}>
                  <input type="checkbox" checked={checked} disabled={full} onChange={() => props.onToggle(lead.leadId)} />
                </label>
                <div className="candidate-title">
                  {lead.officialSiteUrl ? (
                    <a className="lead-card-name" href={lead.officialSiteUrl} target="_blank" rel="noreferrer">
                      {lead.companyName}
                    </a>
                  ) : (
                    <strong>{lead.companyName}</strong>
                  )}
                  <span className="lead-card-sub">
                    {lead.leadId} / {lead.leadType}
                    {lead.region ? ` / ${lead.region}` : ""}
                  </span>
                </div>
                <span className="score-badge">{lead.salesScore}</span>
              </div>

              <div className="lead-card-links">
                {lead.contactMethod === "メール" ? (
                  <span>
                    <Mail size={13} /> {lead.emailAddress}
                  </span>
                ) : (
                  <>
                    <a href={lead.contactFormUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} /> フォームを開く
                    </a>
                    <button
                      type="button"
                      className="btn secondary icon-only"
                      onClick={() => setEditing({ leadId: lead.leadId, draft: lead.contactFormUrl, error: "", saving: false })}
                      title={`フォームURLを変更（${lead.contactFormUrl}）`}
                    >
                      <Pencil size={13} />
                    </button>
                  </>
                )}
                {manualOnly && <span className="status-badge reply">手動のみ（CAPTCHA）</span>}
              </div>

              {editing?.leadId === lead.leadId && (
                <div className="url-edit">
                  <input
                    value={editing.draft}
                    autoFocus
                    disabled={editing.saving}
                    onChange={(event) => setEditing({ ...editing, draft: event.target.value, error: "" })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveUrl(lead);
                      if (event.key === "Escape") setEditing(null);
                    }}
                    placeholder="https://example.com/contact/"
                    aria-label={`${lead.leadId} のフォームURL`}
                  />
                  <button type="button" className="btn primary icon-only" disabled={editing.saving} onClick={() => void saveUrl(lead)} title="保存">
                    <Check size={14} />
                  </button>
                  <button type="button" className="btn secondary icon-only" disabled={editing.saving} onClick={() => setEditing(null)} title="キャンセル">
                    <X size={14} />
                  </button>
                  {editing.error && <p className="url-edit-error">{editing.error}</p>}
                </div>
              )}

              <LeadLogControls
                leadId={lead.leadId}
                currentNote={lead.currentNote ?? ""}
                latestLog={lead.latestLog ?? null}
                onSaveNote={(text) => props.onSaveNote(lead, text)}
                onOpenLog={() => props.onOpenLog(lead)}
              />

              <textarea
                key={`${lead.leadId}:${lead.memo}`}
                ref={autoResize}
                className="memo-input card-memo"
                rows={2}
                defaultValue={lead.memo}
                placeholder="メモを入力（離れると保存）"
                onInput={(event) => autoResize(event.currentTarget)}
                onBlur={(event) => props.onMemoSave(lead, event.target.value)}
              />

              <div className="lead-card-actions">
                <button className="btn secondary" type="button" onClick={() => props.onShowMessage(lead)}>
                  <MessageSquare size={15} />
                  メッセージを確認
                </button>
                <ActionMenu items={menuItems} label="ステータスを変更" />
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
