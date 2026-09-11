"use client";

import { useEffect, useMemo, useState } from "react";

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

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [leadTypeFilter, setLeadTypeFilter] = useState(ALL);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/leads")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        return body.leads as Lead[];
      })
      .then((data) => {
        if (!cancelled) {
          setLeads(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "読み込みに失敗しました");
        }
      });

    return () => {
      cancelled = true;
    };
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

  if (error) {
    return <p className="text-[var(--danger)]">読み込みエラー: {error}</p>;
  }

  if (!leads) {
    return <p className="text-[var(--muted)]">読み込み中...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1">
          ステータス
          <select
            className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          営業先種別
          <select
            className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1"
            value={leadTypeFilter}
            onChange={(event) => setLeadTypeFilter(event.target.value)}
          >
            {leadTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto self-center text-[var(--muted)]">{filtered.length}件</span>
      </div>

      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--panel)] text-left">
              <th className="px-3 py-2">リードID</th>
              <th className="px-3 py-2">企業名</th>
              <th className="px-3 py-2">種別</th>
              <th className="px-3 py-2">地域</th>
              <th className="px-3 py-2">連絡方法</th>
              <th className="px-3 py-2 text-right">スコア</th>
              <th className="px-3 py-2">ステータス</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead) => (
              <tr key={lead.leadId} className="border-b border-[var(--border)]">
                <td className="px-3 py-2 whitespace-nowrap">{lead.leadId}</td>
                <td className="px-3 py-2">
                  {lead.officialSiteUrl ? (
                    <a
                      className="hover:underline"
                      href={lead.officialSiteUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {lead.companyName}
                    </a>
                  ) : (
                    lead.companyName
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{lead.leadType}</td>
                <td className="px-3 py-2 whitespace-nowrap">{lead.region}</td>
                <td className="px-3 py-2 whitespace-nowrap">{lead.contactMethod}</td>
                <td className="px-3 py-2 text-right">{lead.salesScore}</td>
                <td className="px-3 py-2 whitespace-nowrap">{lead.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
