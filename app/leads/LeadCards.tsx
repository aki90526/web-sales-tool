"use client";

import { CheckCircle2, ExternalLink, MessageSquare, Mail, MousePointerClick, Pencil, Sparkles, TextCursorInput } from "lucide-react";
import { STATUSES } from "../../src/domain/lead";

export type CardLead = {
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
};

export type CardNotice = { status: "success" | "failed"; text: string };

type LeadCardsProps<T extends CardLead> = {
  leads: T[];
  highlightedLeadId: string | null;
  // いずれかの実行（メール送信・自動入力など）が動いている間は、実行系のボタンを押せなくする
  busy: boolean;
  runningLeadId: string | null;
  updatingLeadId: string | null;
  notices: Record<string, CardNotice>;
  statusClass: (status: string) => string;
  methodClass: (method: string) => string;
  onStatusChange: (lead: T, status: string) => void;
  onMemoSave: (lead: T, memo: string) => void;
  onEditFormUrl: (lead: T) => void;
  onEditEmail: (lead: T) => void;
  onShowMessage: (lead: T) => void;
  onSendEmail: (lead: T) => void;
  onAutoFill: (lead: T) => void;
  onManualFill: (lead: T) => void;
  onMarkFormSent: (lead: T) => void;
};

// メモ欄の高さを、内容に合わせる（普段は最大3行まで。編集中は全文を表示する。上限はCSS側）
const autoResize = (element: HTMLTextAreaElement | null): void => {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
};

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

// リードを、カードで表示する。メール送信・フォーム自動入力・フォーム手動入力のボタンをここに置く
export default function LeadCards<T extends CardLead>(props: LeadCardsProps<T>) {
  const { leads, busy, runningLeadId } = props;

  return (
    <div className="lead-card-grid">
      {leads.map((lead) => {
        const waiting = lead.status === "送信待ち";
        const isEmail = lead.contactMethod === "メール";
        const isForm = lead.contactMethod === "フォーム";
        const hasFormUrl = /^https?:\/\//i.test(lead.contactFormUrl);
        const canSendEmail = waiting && isEmail && isValidEmail(lead.emailAddress);
        const canFill = waiting && isForm && hasFormUrl;
        const running = runningLeadId === lead.leadId;
        const notice = props.notices[lead.leadId];

        return (
          <article
            key={lead.leadId}
            id={`lead-card-${lead.leadId}`}
            className={`lead-card${props.highlightedLeadId === lead.leadId ? " selected" : ""}`}
          >
            <div className="lead-card-head">
              <div>
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

            <div className="lead-card-row">
              <select
                className={`${props.statusClass(lead.status)} status-select`}
                aria-label={`${lead.leadId} のステータス`}
                value={STATUSES.includes(lead.status as (typeof STATUSES)[number]) ? lead.status : ""}
                disabled={props.updatingLeadId === lead.leadId}
                onChange={(event) => props.onStatusChange(lead, event.target.value)}
              >
                {!STATUSES.includes(lead.status as (typeof STATUSES)[number]) && <option value="">{lead.status || "未設定"}</option>}
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              {isForm && hasFormUrl ? (
                <a className={props.methodClass(lead.contactMethod)} href={lead.contactFormUrl} target="_blank" rel="noreferrer" title={`フォームを開く（${lead.contactFormUrl}）`}>
                  {lead.contactMethod}
                </a>
              ) : (
                <span className={props.methodClass(lead.contactMethod)}>{lead.contactMethod || "未設定"}</span>
              )}
              {/* 登録・変更のボタン。登録済みは鉛筆、未登録は、メールならメールのアイコン、フォームならフォームのアイコン */}
              <button
                className="btn secondary icon-only"
                type="button"
                onClick={() => props.onEditEmail(lead)}
                title={lead.emailAddress ? `メールアドレスを変更（${lead.emailAddress}）` : "メールアドレスを登録"}
              >
                {lead.emailAddress ? <Pencil size={13} /> : <Mail size={13} />}
              </button>
              <button
                className="btn secondary icon-only"
                type="button"
                onClick={() => props.onEditFormUrl(lead)}
                title={lead.contactFormUrl ? `フォームURLを変更（${lead.contactFormUrl}）` : "フォームURLを登録"}
              >
                {lead.contactFormUrl ? <Pencil size={13} /> : <TextCursorInput size={13} />}
              </button>
            </div>

            <div className="lead-card-links">
              {isEmail && lead.emailAddress && (
                <span>
                  <Mail size={13} /> {lead.emailAddress}
                </span>
              )}
              {isForm && hasFormUrl && (
                <a href={lead.contactFormUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> フォームを開く
                </a>
              )}
            </div>

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
              {isEmail && (
                <button
                  className="btn primary"
                  type="button"
                  disabled={!canSendEmail || busy}
                  onClick={() => props.onSendEmail(lead)}
                  title={canSendEmail ? "このリードへメールを送信します" : "「送信待ち」で、メールアドレスが正しいリードだけ送信できます"}
                >
                  <Mail size={15} />
                  {running ? "送信中..." : "メール送信"}
                </button>
              )}
              {isForm && (
                <>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={!canFill || busy}
                    onClick={() => props.onAutoFill(lead)}
                    title={canFill ? "Chromeでフォームに自動入力します（送信は自分で行います）" : "「送信待ち」で、フォームURLがあるリードだけ使えます"}
                  >
                    <Sparkles size={15} />
                    {running ? "入力中..." : "フォーム自動入力"}
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={!hasFormUrl}
                    onClick={() => props.onManualFill(lead)}
                    title="フォームを開き、件名・本文をコピーして自分で入力します"
                  >
                    <MousePointerClick size={15} />
                    フォーム手動入力
                  </button>
                  <button
                    className="btn secondary icon-only"
                    type="button"
                    disabled={busy}
                    onClick={() => props.onMarkFormSent(lead)}
                    title="フォーム送信済みにする"
                  >
                    <CheckCircle2 size={15} />
                  </button>
                </>
              )}
              <button className="btn secondary icon-only" type="button" onClick={() => props.onShowMessage(lead)} title="メッセージを見る">
                <MessageSquare size={15} />
              </button>
            </div>

            {notice && <p className={notice.status === "success" ? "success-box" : "error-box"}>{notice.text}</p>}
          </article>
        );
      })}
    </div>
  );
}
