"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { CheckCircle2, Clock3, Send, Users } from "lucide-react";

type Lead = {
  leadId: string;
  companyName: string;
  leadType: string;
  industry: string;
  region: string;
  officialSiteUrl: string;
  contactMethod: string;
  salesScore: number;
  status: string;
  nextActionDate: string;
};

type DashboardJob = {
  id: string;
  label: string;
  status: "running" | "success" | "failed";
  startedAt: string;
};

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

const pct = (value: number, total: number): number => (total === 0 ? 0 : Math.round((value / total) * 100));

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/leads").then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
        return body.leads as Lead[];
      }),
      fetch("/api/jobs", { cache: "no-store" }).then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
        return body.jobs as DashboardJob[];
      })
    ])
      .then(([leadData, jobData]) => {
        if (!cancelled) {
          setLeads(leadData);
          setJobs(jobData);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "読み込みに失敗しました");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const source = leads ?? [];
    const waiting = source.filter((lead) => lead.status === "送信待ち").length;
    const sent = source.filter((lead) => lead.status === "送信済み").length;
    const replies = source.filter((lead) => lead.status === "返信あり").length;
    const email = source.filter((lead) => lead.contactMethod === "メール").length;
    const forms = source.filter((lead) => lead.contactMethod === "問い合わせフォーム").length;
    const others = Math.max(source.length - email - forms, 0);
    const byType = ["Web制作会社", "広告代理店", "直クライアント"].map((type) => ({
      label: type.replace("Web", ""),
      value: source.filter((lead) => lead.leadType === type).length
    }));
    const maxType = Math.max(...byType.map((item) => item.value), 1);

    return { total: source.length, waiting, sent, replies, email, forms, others, byType, maxType };
  }, [leads]);

  const recentLeads = useMemo(() => {
    return [...(leads ?? [])]
      .sort((a, b) => b.salesScore - a.salesScore)
      .slice(0, 6);
  }, [leads]);

  const emailDegrees = pct(stats.email, stats.total) * 3.6;
  const formDegrees = emailDegrees + pct(stats.forms, stats.total) * 3.6;

  if (error) {
    return <p className="error-box">読み込みエラー: {error}</p>;
  }

  if (!leads) {
    return <p className="panel">読み込み中...</p>;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <h2>ダッシュボード</h2>
          <p>営業リード、送信待ち、直近の実行状況を確認できます。</p>
        </div>
      </div>

      <section className="kpi-grid">
        <article className="kpi-card" style={{ "--card-color": "#2f6df6", "--card-bg": "#dbeafe" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>全リード</span>
            <span className="kpi-icon"><Users size={19} /></span>
          </div>
          <div className="kpi-value">{stats.total}</div>
          <span className="kpi-note">管理中</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#10b981", "--card-bg": "#d1fae5" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>送信待ち</span>
            <span className="kpi-icon"><Clock3 size={19} /></span>
          </div>
          <div className="kpi-value">{stats.waiting}</div>
          <span className="kpi-note">対応対象</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#f59e0b", "--card-bg": "#fef3c7" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>送信済み</span>
            <span className="kpi-icon"><Send size={19} /></span>
          </div>
          <div className="kpi-value">{stats.sent}</div>
          <span className="kpi-note">履歴あり</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#ef4444", "--card-bg": "#fee2e2" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>返信あり</span>
            <span className="kpi-icon"><CheckCircle2 size={19} /></span>
          </div>
          <div className="kpi-value">{stats.replies}</div>
          <span className="kpi-note">要フォロー</span>
        </article>
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">営業先種別</h3>
              <p className="panel-caption">候補リードの構成比を確認します。</p>
            </div>
            <div className="segmented">
              <span className="segment active">件数</span>
              <span className="segment">比率</span>
            </div>
          </div>
          <div className="bar-chart">
            {stats.byType.map((item, index) => (
              <div className="bar-item" key={item.label}>
                <span className="bar-value">{item.value}</span>
                <span
                  className={index === stats.byType.length - 1 ? "bar green" : "bar"}
                  style={{ height: `${Math.max(24, (item.value / stats.maxType) * 150)}px` }}
                />
                <span className="bar-label">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">連絡方法</h3>
              <p className="panel-caption">メールとフォームの割合です。</p>
            </div>
          </div>
          <div className="donut-wrap">
            <div
              className="donut"
              style={
                {
                  "--email-deg": `${emailDegrees}deg`,
                  "--form-deg": `${formDegrees}deg`
                } as CSSProperties
              }
            >
              <div className="donut-inner">
                <span>
                  <span className="donut-number">{stats.total}</span>
                  <span className="donut-label">全リード</span>
                </span>
              </div>
            </div>
            <div className="legend">
              <span className="legend-item"><span className="legend-dot" style={{ "--dot": "#2f6df6" } as CSSProperties} />メール {stats.email}</span>
              <span className="legend-item"><span className="legend-dot" style={{ "--dot": "#f59e0b" } as CSSProperties} />フォーム {stats.forms}</span>
              <span className="legend-item"><span className="legend-dot" style={{ "--dot": "#64748b" } as CSSProperties} />その他 {stats.others}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">優先リード</h3>
            <p className="panel-caption">スコアの高いリードを上から表示しています。</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>リードID</th>
                <th>企業名</th>
                <th>種別</th>
                <th>連絡方法</th>
                <th>スコア</th>
                <th>ステータス</th>
              </tr>
            </thead>
            <tbody>
              {recentLeads.map((lead) => (
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
                  <td><span className={methodClass(lead.contactMethod)}>{lead.contactMethod || "未設定"}</span></td>
                  <td><span className="score-badge">{lead.salesScore}</span></td>
                  <td><span className={statusClass(lead.status)}>{lead.status || "未設定"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">最近の実行</h3>
            <p className="panel-caption">ボタン操作の実行ログです。</p>
          </div>
        </div>
        {jobs.length === 0 ? (
          <p className="panel-caption">実行ログはまだありません。</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>操作</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {jobs.slice(0, 5).map((job) => (
                  <tr key={job.id}>
                    <td>{new Date(job.startedAt).toLocaleString("ja-JP")}</td>
                    <td>{job.label}</td>
                    <td><span className={statusClass(job.status === "success" ? "送信済み" : job.status)}>{job.status}</span></td>
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
