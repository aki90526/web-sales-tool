"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, MousePointerClick } from "lucide-react";

type FormLead = {
  leadId: string;
  companyName: string;
  leadType: string;
  officialSiteUrl: string;
  contactMethod: string;
  contactFormUrl: string;
  salesScore: number;
  status: string;
  memo: string;
};

type FormLeadCardsProps = {
  // ジョブの実行後などに、一覧を読み直すための値
  refreshKey: number;
  selectedLeadId: string;
  onSelect: (leadId: string) => void;
};

// 送信待ちのまま残さず、見送りなどへ変える候補のステータス
const CHANGE_STATUSES = ["見送り", "保留", "除外", "商談中", "面談済み", "返信あり"] as const;

const isFormTarget = (lead: FormLead): boolean => {
  return lead.status === "送信待ち" && lead.contactMethod === "フォーム" && /^https?:\/\//i.test(lead.contactFormUrl);
};

// 送信待ちのフォームリードを、カードで一覧表示する。メモの保存とステータスの変更を、ここで行える
export default function FormLeadCards({ refreshKey, selectedLeadId, onSelect }: FormLeadCardsProps) {
  const [leads, setLeads] = useState<FormLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leads");
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const targets = (body.leads as FormLead[]).filter(isFormTarget).sort((a, b) => b.salesScore - a.salesScore);
      setLeads(targets);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const post = async (url: string, payload: Record<string, string>): Promise<void> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message ?? `HTTP ${res.status}`);
    }
  };

  const saveMemo = async (lead: FormLead, memo: string) => {
    if (memo === lead.memo) return;
    setSavingId(lead.leadId);
    try {
      await post("/api/leads/memo", { leadId: lead.leadId, memo });
      setLeads((current) => current?.map((entry) => (entry.leadId === lead.leadId ? { ...entry, memo } : entry)) ?? current);
      setNotice(`${lead.leadId} のメモを保存しました`);
      setError(null);
    } catch (err) {
      setError(`メモの保存に失敗しました: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setSavingId(null);
    }
  };

  // ステータスを変更する。入力中のメモも、あわせて保存する
  const changeStatus = async (lead: FormLead, status: string, memo: string) => {
    setSavingId(lead.leadId);
    try {
      if (memo !== lead.memo) {
        await post("/api/leads/memo", { leadId: lead.leadId, memo });
      }
      await post("/api/leads/status", { leadId: lead.leadId, status });
      setLeads((current) => current?.filter((entry) => entry.leadId !== lead.leadId) ?? current);
      setNotice(`${lead.leadId} ${lead.companyName} を「${status}」にしました`);
      setError(null);
    } catch (err) {
      setError(`ステータスの変更に失敗しました: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="form-panel">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">フォーム送信待ちのリード</h3>
          <p className="panel-caption">
            スコアの高い順です。メモは入力欄から離れると保存されます。送らないリードは、ここで「見送り」などに変更できます。
          </p>
        </div>
        <span className="status-badge waiting">{leads ? `${leads.length}件` : "読み込み中"}</span>
      </div>

      {error && <p className="error-box mt-4">{error}</p>}
      {notice && !error && <p className="success-box mt-4">{notice}</p>}
      {leads && leads.length === 0 && <p className="panel-caption mt-4">フォーム送信待ちのリードはありません。</p>}

      <div className="lead-card-grid mt-4">
        {leads?.map((lead) => (
          <article key={lead.leadId} className={`lead-card${selectedLeadId === lead.leadId ? " selected" : ""}`}>
            <div className="lead-card-head">
              <div>
                <strong>{lead.companyName}</strong>
                <span className="lead-card-sub">
                  {lead.leadId} / {lead.leadType}
                </span>
              </div>
              <span className="score-badge">{lead.salesScore}</span>
            </div>

            <div className="lead-card-links">
              <a href={lead.contactFormUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={13} /> フォームを開く
              </a>
              {lead.officialSiteUrl && (
                <a href={lead.officialSiteUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> 公式サイト
                </a>
              )}
            </div>

            <textarea
              key={`${lead.leadId}:${lead.memo}`}
              className="memo-input"
              rows={3}
              defaultValue={lead.memo}
              placeholder="メモを入力（離れると保存）"
              onBlur={(event) => void saveMemo(lead, event.target.value)}
            />

            <div className="lead-card-actions">
              <button
                className="btn secondary"
                type="button"
                onClick={() => onSelect(lead.leadId)}
                title="上の「フォーム」のリードID欄に入れて、自動入力・送信済みなどの対象にします"
              >
                <MousePointerClick size={15} />
                このリードを選ぶ
              </button>
              <select
                aria-label={`${lead.leadId} のステータスを変更`}
                value=""
                disabled={savingId === lead.leadId}
                onChange={(event) => {
                  const memoField = event.currentTarget.closest("article")?.querySelector("textarea");
                  void changeStatus(lead, event.target.value, memoField?.value ?? lead.memo);
                }}
              >
                <option value="" disabled>
                  ステータスを変更…
                </option>
                {CHANGE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}にする
                  </option>
                ))}
              </select>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
