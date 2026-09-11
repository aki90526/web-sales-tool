"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Filter, Mail, MousePointerClick, RefreshCw, Users } from "lucide-react";

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

const statusClass = (status: string): string => {
  if (status === "送信待ち") return "status-badge waiting";
  if (status === "送信済み") return "status-badge sent";
  if (status === "返信あり") return "status-badge reply";
  return "status-badge";
};

const methodClass = (method: string): string => {
  if (method === "メール") return "method-badge email";
  if (method === "問い合わせフォーム") return "method-badge form";
  return "method-badge";
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [leadTypeFilter, setLeadTypeFilter] = useState(ALL);

  const loadLeads = () => {
    setError(null);
    setLeads(null);
    fetch("/api/leads")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        return body.leads as Lead[];
      })
      .then((data) => setLeads(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "読み込みに失敗しました"));
  };

  useEffect(() => {
    loadLeads();
  }, []);

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
      .sort((a, b) => b.salesScore - a.salesScore);
  }, [leads, statusFilter, leadTypeFilter]);

  const stats = useMemo(() => {
    const source = leads ?? [];
    return {
      total: source.length,
      email: source.filter((lead) => lead.contactMethod === "メール").length,
      form: source.filter((lead) => lead.contactMethod === "問い合わせフォーム").length,
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
                  <th>リードID</th>
                  <th>企業名</th>
                  <th>種別</th>
                  <th>地域</th>
                  <th>連絡方法</th>
                  <th>スコア</th>
                  <th>ステータス</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr key={lead.leadId}>
                    <td>{lead.leadId}</td>
                    <td>
                      {lead.officialSiteUrl ? (
                        <a className="text-[var(--accent)] hover:underline" href={lead.officialSiteUrl} target="_blank" rel="noreferrer">
                          {lead.companyName}
                        </a>
                      ) : (
                        lead.companyName
                      )}
                    </td>
                    <td>{lead.leadType}</td>
                    <td>{lead.region}</td>
                    <td><span className={methodClass(lead.contactMethod)}>{lead.contactMethod || "未設定"}</span></td>
                    <td><span className="score-badge">{lead.salesScore}</span></td>
                    <td><span className={statusClass(lead.status)}>{lead.status || "未設定"}</span></td>
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
