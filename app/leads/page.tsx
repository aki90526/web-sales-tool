"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, CheckCircle2, Copy, Filter, Mail, MessageSquare, MousePointerClick, RefreshCw, Users, X } from "lucide-react";
import { STATUSES } from "../../src/domain/lead";

type Lead = {
  rowNumber: number;
  leadId: string;
  companyName: string;
  leadType: string;
  industry: string;
  region: string;
  officialSiteUrl: string;
  contactMethod: string;
  contactFormUrl: string;
  emailAddress: string;
  salesScore: number;
  status: string;
  lastApproachDate: string;
  nextActionDate: string;
  memo: string;
};

const ALL = "すべて";

const autoResizeTextarea = (el: HTMLTextAreaElement | null): void => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

const leadIdSortValue = (leadId: string): number => {
  const match = /^L-(\d+)$/.exec(leadId);
  return match ? Number(match[1]) : -1;
};

const statusClass = (status: string): string => {
  if (status === "送信待ち") return "status-badge waiting";
  if (status === "送信済み") return "status-badge sent";
  if (status === "返信あり") return "status-badge reply";
  return "status-badge";
};

const methodClass = (method: string): string => {
  if (method === "メール") return "method-badge email";
  if (method === "フォーム") return "method-badge form";
  return "method-badge";
};

const rowClass = (status: string): string => {
  if (status === "送信済み") return "row-sent";
  if (status === "見送り") return "row-skip";
  if (status === "除外") return "row-excluded";
  return "";
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [leadTypeFilter, setLeadTypeFilter] = useState(ALL);
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [messageModal, setMessageModal] = useState<{ leadId: string; companyName: string } | null>(null);
  const [messageContent, setMessageContent] = useState<{ subject: string; body: string } | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [markSentLeadId, setMarkSentLeadId] = useState<string | null>(null);
  const [focusLeadId, setFocusLeadId] = useState<string | null>(null);
  const [highlightedLeadId, setHighlightedLeadId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    setFocusLeadId(new URLSearchParams(window.location.search).get("leadId"));
  }, []);

  useEffect(() => {
    if (!leads || !focusLeadId) return;

    const row = rowRefs.current[focusLeadId];
    if (!row) return;

    row.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedLeadId(focusLeadId);
    const timer = setTimeout(() => setHighlightedLeadId(null), 5000);

    return () => clearTimeout(timer);
  }, [leads, focusLeadId]);

  const fetchLeads = async (): Promise<Lead[]> => {
    const res = await fetch("/api/leads");
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.message ?? `HTTP ${res.status}`);
    }
    return body.leads as Lead[];
  };

  const loadLeads = () => {
    setError(null);
    setLeads(null);
    fetchLeads()
      .then((data) => setLeads(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "読み込みに失敗しました"));
  };

  const refreshLeadsQuietly = async () => {
    try {
      const data = await fetchLeads();
      setLeads(data);
    } catch {
      // 一覧の再取得のみのため、失敗しても既存表示を維持する
    }
  };

  useEffect(() => {
    loadLeads();
  }, []);

  const updateMemo = async (lead: Lead, nextMemo: string) => {
    if (nextMemo === lead.memo) return;

    const previousMemo = lead.memo;
    setStatusError(null);
    setLeads((current) =>
      current
        ? current.map((entry) => (entry.leadId === lead.leadId ? { ...entry, memo: nextMemo } : entry))
        : current
    );

    try {
      const res = await fetch("/api/leads/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.leadId, memo: nextMemo })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setLeads((current) =>
        current
          ? current.map((entry) => (entry.leadId === lead.leadId ? { ...entry, memo: previousMemo } : entry))
          : current
      );
      setStatusError(err instanceof Error ? err.message : "メモの更新に失敗しました");
    }
  };

  const updateStatus = async (lead: Lead, nextStatus: string) => {
    if (nextStatus === lead.status) return;

    const previousStatus = lead.status;
    setStatusError(null);
    setUpdatingLeadId(lead.leadId);
    setLeads((current) =>
      current
        ? current.map((entry) => (entry.leadId === lead.leadId ? { ...entry, status: nextStatus } : entry))
        : current
    );

    try {
      const res = await fetch("/api/leads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.leadId, status: nextStatus })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setLeads((current) =>
        current
          ? current.map((entry) => (entry.leadId === lead.leadId ? { ...entry, status: previousStatus } : entry))
          : current
      );
      setStatusError(err instanceof Error ? err.message : "ステータスの更新に失敗しました");
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const markFormSent = async (lead: Lead) => {
    const confirmed = window.confirm(`${lead.companyName}（${lead.leadId}）をフォーム送信済みにしますか？`);
    if (!confirmed) return;

    setStatusError(null);
    setMarkSentLeadId(lead.leadId);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "forms-mark-sent",
          leadId: lead.leadId,
          note: "リード一覧から手動フォーム送信済み",
          confirm: true
        })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      if (body.job?.status === "failed") {
        throw new Error(body.job.stderr || body.job.stdout || "処理に失敗しました");
      }
      await refreshLeadsQuietly();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "フォーム送信済みの更新に失敗しました");
    } finally {
      setMarkSentLeadId(null);
    }
  };

  const openMessage = async (lead: Lead) => {
    setMessageModal({ leadId: lead.leadId, companyName: lead.companyName });
    setMessageContent(null);
    setMessageError(null);
    setMessageLoading(true);
    setCopied(false);

    try {
      const res = await fetch(`/api/leads/message?leadId=${encodeURIComponent(lead.leadId)}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setMessageContent({ subject: body.subject, body: body.body });
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : "メッセージの取得に失敗しました");
    } finally {
      setMessageLoading(false);
    }
  };

  const closeMessage = () => {
    setMessageModal(null);
    setMessageContent(null);
    setMessageError(null);
  };

  const copyMessage = async () => {
    if (!messageContent) return;
    const text = `${messageContent.subject}\n\n${messageContent.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessageError("コピーに失敗しました。手動で選択してコピーしてください。");
    }
  };

  const statuses = useMemo(() => {
    if (!leads) return [ALL];
    return [ALL, ...Array.from(new Set(leads.map((lead) => lead.status).filter(Boolean)))];
  }, [leads]);

  const leadTypes = useMemo(() => {
    if (!leads) return [ALL];
    return [ALL, ...Array.from(new Set(leads.map((lead) => lead.leadType).filter(Boolean)))];
  }, [leads]);

  const filtered = useMemo(() => {
    if (!leads) return [];
    return leads
      .filter((lead) => statusFilter === ALL || lead.status === statusFilter)
      .filter((lead) => leadTypeFilter === ALL || lead.leadType === leadTypeFilter)
      .sort((a, b) => leadIdSortValue(b.leadId) - leadIdSortValue(a.leadId));
  }, [leads, statusFilter, leadTypeFilter]);

  const stats = useMemo(() => {
    const source = leads ?? [];
    return {
      total: source.length,
      email: source.filter((lead) => lead.contactMethod === "メール").length,
      form: source.filter((lead) => lead.contactMethod === "フォーム").length,
      waiting: source.filter((lead) => lead.status === "送信待ち").length
    };
  }, [leads]);

  if (error) {
    return <p className="error-box">読み込みエラー: {error}</p>;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <h2>リード一覧</h2>
          <p>営業管理シートのリードを確認・絞り込みできます。</p>
        </div>
        <button className="btn secondary" onClick={loadLeads}>
          <RefreshCw size={16} />
          更新
        </button>
      </div>

      {statusError && <p className="error-box">ステータス更新エラー: {statusError}</p>}

      <section className="kpi-grid">
        <article className="kpi-card">
          <div className="kpi-card-head">
            <span>全リード</span>
            <span className="kpi-icon"><Users size={18} /></span>
          </div>
          <div className="kpi-value">{stats.total}</div>
          <span className="kpi-note">表示対象</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#2f6df6", "--card-bg": "#dbeafe" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>メール</span>
            <span className="kpi-icon"><Mail size={18} /></span>
          </div>
          <div className="kpi-value">{stats.email}</div>
          <span className="kpi-note">送信候補</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#f59e0b", "--card-bg": "#fef3c7" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>フォーム</span>
            <span className="kpi-icon"><MousePointerClick size={18} /></span>
          </div>
          <div className="kpi-value">{stats.form}</div>
          <span className="kpi-note">手動確認</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#10b981", "--card-bg": "#d1fae5" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>送信待ち</span>
            <span className="kpi-icon"><Filter size={18} /></span>
          </div>
          <div className="kpi-value">{stats.waiting}</div>
          <span className="kpi-note">次に対応</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">リード</h3>
            <p className="panel-caption">{filtered.length}件を表示しています。</p>
          </div>
          <div className="btn-row">
            <label className="field">
              ステータス
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              営業先種別
              <select value={leadTypeFilter} onChange={(event) => setLeadTypeFilter(event.target.value)}>
                {leadTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {!leads ? (
          <p className="panel-caption">読み込み中...</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="hide-mobile col-fixed-80">リードID</th>
                  <th className="col-fixed-180">企業名</th>
                  <th className="hide-mobile">種別</th>
                  <th className="hide-mobile col-fixed-120">地域</th>
                  <th className="hide-mobile">連絡方法</th>
                  <th>スコア</th>
                  <th>ステータス</th>
                  <th className="hide-mobile col-flex-wide">メモ</th>
                  <th className="cell-nowrap">メッセージ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr
                    key={lead.leadId}
                    ref={(el) => {
                      rowRefs.current[lead.leadId] = el;
                    }}
                    className={`${rowClass(lead.status)}${highlightedLeadId === lead.leadId ? " row-highlight" : ""}`}
                  >
                    <td className="hide-mobile col-fixed-80">{lead.leadId}</td>
                    <td className="col-fixed-180">
                      {lead.officialSiteUrl ? (
                        <a className="text-[var(--accent)] hover:underline" href={lead.officialSiteUrl} target="_blank" rel="noreferrer">
                          {lead.companyName}
                        </a>
                      ) : (
                        lead.companyName
                      )}
                    </td>
                    <td className="hide-mobile">{lead.leadType}</td>
                    <td className="hide-mobile col-fixed-120">{lead.region}</td>
                    <td className="hide-mobile">
                      {lead.contactMethod === "フォーム" && lead.contactFormUrl ? (
                        <a className={methodClass(lead.contactMethod)} href={lead.contactFormUrl} target="_blank" rel="noreferrer">
                          {lead.contactMethod}
                        </a>
                      ) : (
                        <span className={methodClass(lead.contactMethod)}>{lead.contactMethod || "未設定"}</span>
                      )}
                    </td>
                    <td><span className="score-badge">{lead.salesScore}</span></td>
                    <td>
                      <select
                        className={`${statusClass(lead.status)} status-select`}
                        value={STATUSES.includes(lead.status as (typeof STATUSES)[number]) ? lead.status : ""}
                        disabled={updatingLeadId === lead.leadId}
                        onChange={(event) => updateStatus(lead, event.target.value)}
                      >
                        {!STATUSES.includes(lead.status as (typeof STATUSES)[number]) && (
                          <option value="">{lead.status || "未設定"}</option>
                        )}
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="hide-mobile col-flex-wide">
                      <textarea
                        key={lead.memo}
                        ref={autoResizeTextarea}
                        className="memo-input"
                        rows={1}
                        defaultValue={lead.memo}
                        placeholder="メモを入力"
                        onInput={(event) => autoResizeTextarea(event.currentTarget)}
                        onBlur={(event) => updateMemo(lead, event.target.value)}
                      />
                    </td>
                    <td className="cell-nowrap">
                      <div className="btn-row-tight">
                        <button className="btn secondary icon-only" type="button" onClick={() => openMessage(lead)} title="メッセージを見る">
                          <MessageSquare size={15} />
                        </button>
                        {lead.contactMethod === "フォーム" && (
                          <button
                            className="btn secondary icon-only"
                            type="button"
                            onClick={() => markFormSent(lead)}
                            disabled={markSentLeadId === lead.leadId}
                            title="フォーム送信済みにする"
                          >
                            <CheckCircle2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {messageModal && (
        <div className="modal-backdrop" onClick={closeMessage}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="panel-title">{messageModal.companyName}</h3>
                <p className="panel-caption">{messageModal.leadId} 宛のメッセージ</p>
              </div>
              <button className="btn secondary icon-only" type="button" onClick={closeMessage} title="閉じる">
                <X size={16} />
              </button>
            </div>

            {messageLoading && <p className="panel-caption">読み込み中...</p>}
            {messageError && <p className="error-box">{messageError}</p>}

            {messageContent && (
              <>
                <label className="field full">
                  件名
                  <input value={messageContent.subject} readOnly />
                </label>
                <label className="field full mt-4">
                  本文
                  <textarea className="memo-input modal-body-text" value={messageContent.body} readOnly rows={16} />
                </label>
                <div className="btn-row mt-4">
                  <button className="btn primary" type="button" onClick={copyMessage}>
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "コピーしました" : "件名・本文をコピー"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
