"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, CheckCircle2, ClipboardCheck, Copy, Mail, MousePointerClick, RefreshCw, ScrollText, Send, X } from "lucide-react";
import UndoToast, { type UndoToastData } from "../components/UndoToast";
import CandidatePanel, { isManualOnly, type Candidate } from "./CandidatePanel";
import ResultBar from "./ResultBar";
import ResultDock from "./ResultDock";
import {
  buildResultMessage,
  formatDateTime,
  jobStatusClass,
  LeadLink,
  OUTCOME_LABELS,
  statusLabel,
  watchStateLabel,
  type CaptchaDetection,
  type DashboardJob,
  type FilledLead,
  type FormOutcomeSummary,
  type FormWatchEntry,
  type JobRequest
} from "./shared";

export default function ActionsPage() {
  const [limit, setLimit] = useState(1);
  const [emailTestTo, setEmailTestTo] = useState("aki90526@gmail.com");
  const [emailBcc, setEmailBcc] = useState("");
  const [bccLoaded, setBccLoaded] = useState(false);
  const [leadId, setLeadId] = useState("");
  // リードID欄が、自動入力の結果で自動的に入ったもの（手入力ではない）か
  const leadIdFromAutoFill = useRef(false);
  const [note, setNote] = useState("");
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [confirmForm, setConfirmForm] = useState(false);
  const [tab, setTab] = useState<"email" | "form">("email");
  const [logOpen, setLogOpen] = useState(false);
  const [logTab, setLogTab] = useState<"watch" | "outcomes" | "jobs">("watch");
  const [allLeads, setAllLeads] = useState<Candidate[] | null>(null);
  // チェックの状態。触っていない間は、スコア上位から「件数」分を自動で選ぶ
  const [selection, setSelection] = useState<{ touched: boolean; ids: string[] }>({ touched: false, ids: [] });
  const [candidateNotice, setCandidateNotice] = useState<string | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<UndoToastData | null>(null);
  const undoInfo = useRef<{ leadId: string; previousStatus: string; historyLine: string } | null>(null);
  const [messageModal, setMessageModal] = useState<{ leadId: string; companyName: string } | null>(null);
  const [messageContent, setMessageContent] = useState<{ subject: string; body: string } | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageCopied, setMessageCopied] = useState(false);
  const [manualMessage, setManualMessage] = useState<{
    companyName: string;
    contactFormUrl: string;
    subject: string;
    body: string;
  } | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualCopied, setManualCopied] = useState(false);
  const [markSentFeedback, setMarkSentFeedback] = useState<{ status: "success" | "failed"; text: string } | null>(
    null
  );
  const [captchaWarning, setCaptchaWarning] = useState<CaptchaDetection | null>(null);
  const [autoFillResult, setAutoFillResult] = useState<FilledLead[] | null>(null);
  const [confirmedLeadIds, setConfirmedLeadIds] = useState<string[]>([]);
  const [fillWarnings, setFillWarnings] = useState<Array<{ leadId: string; message: string }>>([]);
  const [emailResult, setEmailResult] = useState<{ status: "success" | "failed"; text: string } | null>(null);
  const [gmailResult, setGmailResult] = useState<{
    status: "success" | "failed";
    text: string;
    items?: Array<{ leadId: string; company: string; type: string; detail: string }>;
  } | null>(null);
  const [formsTodoResult, setFormsTodoResult] = useState<{ status: "success" | "failed"; text: string } | null>(
    null
  );
  const [targetCounts, setTargetCounts] = useState<{ email: number; form: number; formAuto: number; formManualOnly: number } | null>(null);
  const [outcomeSummary, setOutcomeSummary] = useState<FormOutcomeSummary | null>(null);
  const [watchEntries, setWatchEntries] = useState<FormWatchEntry[]>([]);
  const [watchLoaded, setWatchLoaded] = useState(false);
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [currentJob, setCurrentJob] = useState<DashboardJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadJobs = async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.message ?? `HTTP ${res.status}`);
    }
    setJobs(body.jobs ?? []);
    setActiveJobId(body.activeJobId ?? null);
    loadTargets();
    if (!bccLoaded) {
      setEmailBcc(typeof body.defaultBcc === "string" ? body.defaultBcc : "");
      setBccLoaded(true);
    }
  };

  const loadTargets = () => {
    fetch("/api/targets", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (typeof body.email === "number") setTargetCounts(body);
      })
      .catch(() => undefined);
  };

  const loadLeads = () => {
    fetch("/api/leads", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (Array.isArray(body.leads)) setAllLeads(body.leads as Candidate[]);
      })
      .catch(() => setCandidateError("リードの読み込みに失敗しました"));
  };

  useEffect(() => {
    loadLeads();
  }, []);

  const todayTokyo = useMemo(
    () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    []
  );

  // 実行の対象になるリード（メール／フォームの送信待ち）。スコアの高い順
  const candidates = useMemo(() => {
    if (!allLeads) return null;
    const futureDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value > todayTokyo;

    return allLeads
      .filter((lead) => lead.status === "送信待ち" && !futureDate(lead.nextActionDate))
      .filter((lead) =>
        tab === "email"
          ? lead.contactMethod === "メール" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.emailAddress.trim())
          : lead.contactMethod === "フォーム" && /^https?:\/\//i.test(lead.contactFormUrl)
      )
      // 自動入力できるものを上、手動のみ（CAPTCHAあり）を下に並べる。それぞれ、スコアの高い順
      .sort((a, b) => Number(isManualOnly(a)) - Number(isManualOnly(b)) || b.salesScore - a.salesScore);
  }, [allLeads, tab, todayTokyo]);

  const maxSelect = tab === "email" ? 10 : 5;

  const selectedIds = useMemo(() => {
    if (!candidates) return [];
    if (selection.touched) {
      return selection.ids.filter((id) => candidates.some((lead) => lead.leadId === id));
    }
    // 初期は、スコア上位から「件数」分。フォームは、自動入力できない（CAPTCHAあり）ものを除く
    return candidates
      .filter((lead) => tab === "email" || !isManualOnly(lead))
      .slice(0, Math.min(limit, maxSelect))
      .map((lead) => lead.leadId);
  }, [candidates, selection, limit, maxSelect, tab]);

  const changeTab = (next: "email" | "form") => {
    setTab(next);
    setSelection({ touched: false, ids: [] });
    setLimit((current) => Math.min(current, next === "email" ? 10 : 5));
  };

  const toggleCandidate = (leadId: string) => {
    const current = selectedIds;
    const next = current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId];
    if (next.length > maxSelect) return;
    setSelection({ touched: true, ids: next });
  };

  const saveCandidateMemo = async (lead: Candidate, memo: string) => {
    if (memo === lead.memo) return;
    try {
      const res = await fetch("/api/leads/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.leadId, memo })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      setAllLeads((current) => current?.map((entry) => (entry.leadId === lead.leadId ? { ...entry, memo } : entry)) ?? current);
      setCandidateNotice(`${lead.leadId} のメモを保存しました`);
      setCandidateError(null);
    } catch (err) {
      setCandidateError(`メモの保存に失敗しました: ${err instanceof Error ? err.message : ""}`);
    }
  };

  const changeCandidateStatus = async (lead: Candidate, status: string) => {
    try {
      const res = await fetch("/api/leads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.leadId, status })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      setAllLeads((current) =>
        current?.map((entry) => (entry.leadId === lead.leadId ? { ...entry, status, memo: body.memo ?? entry.memo } : entry)) ?? current
      );
      setCandidateNotice(`${lead.leadId} ${lead.companyName} を「${status}」にしました`);
      setCandidateError(null);
      loadTargets();

      if (body.historyLine && body.previousStatus) {
        undoInfo.current = { leadId: lead.leadId, previousStatus: body.previousStatus, historyLine: body.historyLine };
        setUndoToast({ key: Date.now(), message: `${lead.leadId} ${lead.companyName} を「${status}」にしました` });
      }
    } catch (err) {
      setCandidateError(`ステータスの変更に失敗しました: ${err instanceof Error ? err.message : ""}`);
    }
  };

  const undoCandidateStatus = async () => {
    const info = undoInfo.current;
    setUndoToast(null);
    if (!info) return;

    try {
      const res = await fetch("/api/leads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: info.leadId, status: info.previousStatus, removeLine: info.historyLine })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      setAllLeads((current) =>
        current?.map((entry) => (entry.leadId === info.leadId ? { ...entry, status: info.previousStatus, memo: body.memo ?? entry.memo } : entry)) ?? current
      );
      setCandidateNotice(`${info.leadId} を「${info.previousStatus}」に戻しました`);
      setCandidateError(null);
      loadTargets();
    } catch (err) {
      setCandidateError(`元に戻せませんでした: ${err instanceof Error ? err.message : ""}`);
    }

    undoInfo.current = null;
  };

  const changeCandidateFormUrl = async (lead: Candidate, url: string) => {
    const res = await fetch("/api/leads/form-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.leadId, contactFormUrl: url })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
    setAllLeads((current) => current?.map((entry) => (entry.leadId === lead.leadId ? { ...entry, contactFormUrl: url } : entry)) ?? current);
    setCandidateNotice(`${lead.leadId} のフォームURLを変更しました`);
    setCandidateError(null);
  };

  const showCandidateMessage = async (lead: Candidate) => {
    setMessageModal({ leadId: lead.leadId, companyName: lead.companyName });
    setMessageContent(null);
    setMessageError(null);
    setMessageLoading(true);
    setMessageCopied(false);

    try {
      const res = await fetch(`/api/leads/message?leadId=${encodeURIComponent(lead.leadId)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
      setMessageContent({ subject: body.subject, body: body.body });
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : "メッセージの取得に失敗しました");
    } finally {
      setMessageLoading(false);
    }
  };

  const copyModalMessage = async () => {
    if (!messageContent) return;
    try {
      await navigator.clipboard.writeText(`${messageContent.subject}\n\n${messageContent.body}`);
      setMessageCopied(true);
      setTimeout(() => setMessageCopied(false), 2000);
    } catch {
      setMessageError("コピーに失敗しました。手動で選択してコピーしてください。");
    }
  };

  useEffect(() => {
    fetch("/api/form-outcomes", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => setOutcomeSummary(body))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadJobs().catch(() => undefined);
    loadTargets();
  }, []);

  useEffect(() => {
    const loadWatch = () => {
      fetch("/api/form-watch", { cache: "no-store" })
        .then((res) => res.json())
        .then((body) => {
          const entries: FormWatchEntry[] = Array.isArray(body.entries) ? body.entries : [];
          setWatchEntries(entries);
          setWatchLoaded(true);

          // 自動で「送信済み」になったリードが、リードID欄に自動入力されたままなら空にする
          const recordedIds = new Set(
            entries.filter((entry) => entry.state === "recorded" || entry.state === "already-recorded").map((entry) => entry.leadId)
          );
          if (leadIdFromAutoFill.current) {
            setLeadId((current) => {
              if (current && recordedIds.has(current.trim())) {
                leadIdFromAutoFill.current = false;
                return "";
              }

              return current;
            });
          }
        })
        .catch(() => undefined);
    };

    loadWatch();
    const timer = setInterval(loadWatch, 5000);

    return () => clearInterval(timer);
  }, []);

  const runJob = async (request: JobRequest): Promise<DashboardJob | null> => {
    setError(null);
    setCurrentJob(null);
    setRunning(true);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const job = body.job as DashboardJob;
      setCurrentJob(job);
      await loadJobs();
      return job;
    } catch (err) {
      setError(err instanceof Error ? err.message : "実行に失敗しました");
      await loadJobs().catch(() => undefined);
      return null;
    } finally {
      setRunning(false);
      loadLeads();
    }
  };

  const handleAutoFill = async () => {
    setCaptchaWarning(null);
    setAutoFillResult(null);
    setConfirmedLeadIds([]);
    setFillWarnings([]);
    // CAPTCHAで自動入力できないものは、対象から外す
    const autoIds = selectedIds.filter((id) => {
      const lead = candidates?.find((entry) => entry.leadId === id);
      return lead ? !isManualOnly(lead) : false;
    });
    const skipped = selectedIds.filter((id) => !autoIds.includes(id));

    if (autoIds.length === 0) {
      setError("自動入力できるリードが選ばれていません（CAPTCHAがあるリードは「手動入力」を使ってください）。");
      return;
    }

    const job = await runJob({ command: "forms-fill", leadIds: autoIds });
    setConfirmedLeadIds(job?.confirmedLeadIds ?? []);
    setFillWarnings([
      ...(job?.fillWarnings ?? []),
      ...skipped.map((id) => ({ leadId: id, message: "CAPTCHAがあるため自動入力の対象外にしました（手動入力を使ってください）" }))
    ]);

    if (job?.status === "failed") {
      const reason = (job.stderr || job.stdout || "").trim().split("\n").filter(Boolean).slice(-1)[0];
      setError(`自動入力に失敗しました: ${reason || "原因不明（右下の実行結果を確認してください）"}`);
    }

    if (job?.filledLeads && job.filledLeads.length > 0) {
      setAutoFillResult(job.filledLeads);
      setLeadId(job.filledLeads[0].leadId);
      leadIdFromAutoFill.current = true;
    }

    if (job?.captchaDetections && job.captchaDetections.length > 0) {
      setCaptchaWarning(job.captchaDetections[0]);
    }
  };

  const openManualForm = async (overrideLeadId?: string) => {
    setManualError(null);
    setManualMessage(null);
    setManualCopied(false);
    setManualLoading(true);

    const trimmedLeadId = (overrideLeadId ?? leadId).trim();
    const query = trimmedLeadId ? `leadId=${encodeURIComponent(trimmedLeadId)}` : "next=form";

    try {
      const res = await fetch(`/api/leads/message?${query}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      if (body.leadId) {
        setLeadId(body.leadId);
        leadIdFromAutoFill.current = false;
      }
      if (body.contactFormUrl) {
        window.open(body.contactFormUrl, "_blank", "noopener,noreferrer");
      }
      setManualMessage({
        companyName: body.companyName,
        contactFormUrl: body.contactFormUrl,
        subject: body.subject,
        body: body.body
      });
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "メッセージの取得に失敗しました");
    } finally {
      setManualLoading(false);
    }
  };

  const switchToManual = (detection: CaptchaDetection) => {
    setCaptchaWarning(null);
    setLeadId(detection.leadId);
    setTab("form");
    openManualForm(detection.leadId);
  };

  const copyManualMessage = async () => {
    if (!manualMessage) return;
    const text = `${manualMessage.subject}\n\n${manualMessage.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setManualCopied(true);
      setTimeout(() => setManualCopied(false), 2000);
    } catch {
      setManualError("コピーに失敗しました。手動で選択してコピーしてください。");
    }
  };

  const handleWatchMarkSent = async (entry: FormWatchEntry) => {
    const job = await runJob({
      command: "forms-mark-sent",
      leadId: entry.leadId,
      note:
        entry.state === "manual-required"
          ? "スパム判定のため手動で送信したことを確認して記録"
          : "送信後にトップへ転送されたため、確認のうえ手動で記録",
      confirm: true
    });

    if (job?.status === "success") {
      await fetch("/api/form-watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: entry.leadId, state: "recorded", message: "確認のうえ「送信済み」に更新しました" })
      }).catch(() => undefined);
      setWatchEntries((current) =>
        current.map((item) =>
          item.leadId === entry.leadId
            ? { ...item, state: "recorded", message: "確認のうえ「送信済み」に更新しました" }
            : item
        )
      );
    } else if (job?.status === "failed") {
      setError(`送信済みへの更新に失敗しました: ${(job.stderr || job.stdout || "").trim().split("\n").filter(Boolean).slice(-1)[0] ?? ""}`);
    }
  };

  const handleMarkFormSent = async () => {
    setMarkSentFeedback(null);
    const job = await runJob({ command: "forms-mark-sent", leadId, note, confirm: confirmForm });

    if (!job) return;

    if (job.status === "success") {
      setMarkSentFeedback({
        status: "success",
        text: `送信済みとして登録しました${leadId ? `(${leadId})` : ""}。アプローチ履歴にも記録済みです。`
      });
      setLeadId("");
      leadIdFromAutoFill.current = false;
      setNote("");
      setConfirmForm(false);
      setAutoFillResult(null);
      setManualMessage(null);
    } else {
      setMarkSentFeedback({
        status: "failed",
        text: job.stderr || job.stdout || "登録に失敗しました。"
      });
    }
  };

  const handleEmailAction = async (request: JobRequest) => {
    setEmailResult(null);
    const job = await runJob({ ...request, leadIds: selectedIds });

    if (!job) return;

    if (job.status === "success") {
      setEmailResult({ status: "success", text: buildResultMessage(job) });
    } else {
      setEmailResult({ status: "failed", text: job.stderr || job.stdout || "処理に失敗しました。" });
    }
  };

  const handleGmailAction = async (request: JobRequest) => {
    setGmailResult(null);
    const job = await runJob(request);

    if (!job) return;

    if (job.status === "success") {
      setGmailResult({ status: "success", text: buildResultMessage(job), items: job.updates });
    } else {
      setGmailResult({ status: "failed", text: job.stderr || job.stdout || "処理に失敗しました。" });
    }
  };

  const handleFormsTodo = async () => {
    setFormsTodoResult(null);
    const job = await runJob({ command: "forms-todo", limit: Math.min(selectedIds.length || limit, 5) });

    if (!job) return;

    if (job.status === "success") {
      setFormsTodoResult({ status: "success", text: buildResultMessage(job) });
    } else {
      setFormsTodoResult({ status: "failed", text: job.stderr || job.stdout || "処理に失敗しました。" });
    }
  };

  const handleCheckTargets = () => {
    loadLeads();
    loadTargets();
    setCandidateError(null);
    setCandidateNotice("候補リードを最新の状態に更新しました");
  };

  const overlayMessage = running ? "処理を実行しています..." : manualLoading ? "読み込み中です..." : null;

  return (
    <div className="actions-page">
      {overlayMessage && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-overlay-box">
            <span className="loading-spinner" />
            <p>{overlayMessage}</p>
          </div>
        </div>
      )}
      <div className="actions-layout">
        <div className="actions-main">
        <div className="page-heading">
          <div>
            <h2>実行操作</h2>
            <p>ターミナルで行っていた処理をボタンから実行します。</p>
          </div>
          <span className={running || activeJobId ? "status-badge waiting" : "status-badge sent"}>
            {running || activeJobId ? "処理中" : "実行可能"}
          </span>
        </div>
          <section className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <button
              type="button"
              className={`kpi-card kpi-button${tab === "email" ? " active" : ""}`}
              style={{ "--card-color": "#2f6df6", "--card-bg": "#dbeafe" } as CSSProperties}
              onClick={() => changeTab("email")}
            >
              <div className="kpi-card-head">
                <span>メール</span>
                <span className="kpi-icon"><Mail size={19} /></span>
              </div>
              <div className="kpi-value">{targetCounts ? targetCounts.email : "-"}</div>
              <span className="kpi-note">今すぐ送信できる件数</span>
            </button>
            <button
              type="button"
              className={`kpi-card kpi-button${tab === "form" ? " active" : ""}`}
              style={{ "--card-color": "#f59e0b", "--card-bg": "#fef3c7" } as CSSProperties}
              onClick={() => changeTab("form")}
            >
              <div className="kpi-card-head">
                <span>フォーム</span>
                <span className="kpi-icon"><MousePointerClick size={19} /></span>
              </div>
              <div className="kpi-value">{targetCounts ? targetCounts.form : "-"}</div>
              <span className="kpi-note">
                {targetCounts ? `自動入力できる${targetCounts.formAuto}件 / 手動のみ${targetCounts.formManualOnly}件` : "読み込み中"}
              </span>
            </button>
          </section>

          <section className="form-panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">実行</h3>
                <p className="panel-caption">右の候補リードでチェックしたリードに対して実行します。本送信の前は、件数を小さく確認してください。</p>
              </div>
            </div>

            <div className="segmented">
              <button type="button" className={tab === "email" ? "segment active" : "segment"} onClick={() => changeTab("email")}>
                メール
              </button>
              <button type="button" className={tab === "form" ? "segment active" : "segment"} onClick={() => changeTab("form")}>
                フォーム
              </button>
            </div>

            <div className="exec-toolbar mt-4">
              <label className="inline-field">
                件数
                <input
                  type="number"
                  min={1}
                  max={maxSelect}
                  value={limit}
                  onChange={(event) => {
                    setLimit(Math.max(1, Math.min(maxSelect, Number(event.target.value) || 1)));
                    setSelection({ touched: false, ids: [] });
                  }}
                />
              </label>
              <button className="btn secondary" disabled={running} onClick={handleCheckTargets}>
                <ClipboardCheck size={16} />
                対象確認
              </button>
              <span className="exec-spacer" />
              {tab === "email" ? (
                <button
                  className="btn secondary"
                  disabled={running || selectedIds.length === 0}
                  onClick={() => handleEmailAction({ command: "email-dry-run" })}
                  title="送信せずに、選んだリードが送信対象になるかを確認します"
                >
                  Dry Run
                </button>
              ) : (
                <button
                  className="btn secondary"
                  disabled={running}
                  onClick={handleFormsTodo}
                  title="入力せずに、フォームの対象を確認します"
                >
                  Dry Run
                </button>
              )}
            </div>

            {tab === "email" ? (
              <div className="split-grid mt-4">
                <div className="exec-box">
                  <h4 className="exec-box-title">テスト送信</h4>
                  <label className="field">
                    テスト送信先（複数はカンマ区切り）
                    <input
                      value={emailTestTo}
                      onChange={(event) => setEmailTestTo(event.target.value)}
                      placeholder="a@example.com, b@example.com"
                    />
                  </label>
                  <div className="btn-row mt-4">
                    <button
                      className="btn secondary"
                      disabled={running || selectedIds.length === 0}
                      onClick={() => handleEmailAction({ command: "email-test", testTo: emailTestTo })}
                    >
                      <Mail size={16} />
                      テスト送信
                    </button>
                  </div>
                </div>
                <div className="exec-box">
                  <h4 className="exec-box-title">本送信</h4>
                  <label className="field">
                    BCC（複数はカンマ区切り、空欄でBCCなし）
                    <input value={emailBcc} onChange={(event) => setEmailBcc(event.target.value)} placeholder="BCCなし" />
                  </label>
                  <label className="check-pill mt-4">
                    <input type="checkbox" checked={confirmEmail} onChange={(event) => setConfirmEmail(event.target.checked)} />
                    本送信する内容を確認しました
                  </label>
                  <div className="btn-row mt-4">
                    <button
                      className="btn danger"
                      disabled={running || !confirmEmail || selectedIds.length === 0}
                      onClick={() => handleEmailAction({ command: "email-send", bcc: emailBcc, confirm: confirmEmail })}
                    >
                      <Send size={16} />
                      本送信（{selectedIds.length}件）
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <div className="btn-row">
                  <button className="btn primary" disabled={running || selectedIds.length === 0} onClick={handleAutoFill}>
                    <MousePointerClick size={16} />
                    自動入力（{selectedIds.length}件）
                  </button>
                  <button
                    className="btn secondary"
                    disabled={manualLoading || selectedIds.length === 0}
                    onClick={() => openManualForm(selectedIds[0])}
                    title="選んだ先頭のリードのフォームを開き、件名・本文をコピーして自分で入力します"
                  >
                    <MousePointerClick size={16} />
                    手動入力
                  </button>
                </div>

                {autoFillResult && (
                  <div className="success-box mt-4">
                    <p>
                      {autoFillResult.length}件のフォームを開いてタブに入力しました
                      {confirmedLeadIds.length > 0 ? `（うち${confirmedLeadIds.length}件は確認画面まで進めています）` : ""}
                      。内容を確認して送信してください。送信完了画面を検知すると、自動で「送信済み」に更新します。
                    </p>
                    <ul className="mt-4">
                      {autoFillResult.map((lead) => (
                        <li key={lead.leadId}>
                          <LeadLink leadId={lead.leadId} label={`${lead.leadId} ${lead.companyName}`} />
                          {confirmedLeadIds.includes(lead.leadId) ? "（確認画面まで進行済み）" : "（入力のみ・確認ボタンは手動）"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {fillWarnings.length > 0 && (
                  <div className="error-box mt-4">
                    <p>入力時の警告があります。</p>
                    <ul className="mt-4">
                      {fillWarnings.map((warning, index) => (
                        <li key={`${warning.leadId}-${index}`}>
                          <LeadLink leadId={warning.leadId} />: {warning.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {captchaWarning && (
                  <div className="error-box mt-4">
                    <p>
                      {captchaWarning.leadId} は {captchaWarning.label} が検出されました。自動送信できない可能性が高いため、手動入力をおすすめします。
                    </p>
                    <div className="btn-row mt-4">
                      <button className="btn secondary" type="button" onClick={() => switchToManual(captchaWarning)}>
                        <MousePointerClick size={16} />
                        手動入力に切り替える
                      </button>
                    </div>
                  </div>
                )}
                {formsTodoResult && (
                  <p className={formsTodoResult.status === "success" ? "success-box mt-4" : "error-box mt-4"}>{formsTodoResult.text}</p>
                )}
                {manualLoading && <p className="panel-caption mt-4">読み込み中...</p>}
                {manualError && <p className="error-box mt-4">{manualError}</p>}
                {manualMessage && (
                  <div className="exec-box mt-4">
                    <h4 className="exec-box-title">{manualMessage.companyName} へのメッセージ</h4>
                    <label className="field full">
                      件名
                      <input value={manualMessage.subject} readOnly />
                    </label>
                    <label className="field full mt-4">
                      本文
                      <textarea className="memo-input modal-body-text" value={manualMessage.body} readOnly rows={10} />
                    </label>
                    <div className="btn-row mt-4">
                      <button className="btn secondary" type="button" onClick={copyManualMessage}>
                        {manualCopied ? <Check size={16} /> : <Copy size={16} />}
                        {manualCopied ? "コピーしました" : "件名・本文をコピー"}
                      </button>
                    </div>
                  </div>
                )}

                {leadId.trim() && (
                  <div className="exec-box mt-4">
                    <h4 className="exec-box-title">
                      送信後の記録（対象: <LeadLink leadId={leadId.trim()} />）
                    </h4>
                    <label className="field">
                      送信済みメモ
                      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例: ダッシュボードから手動フォーム送信済み" />
                    </label>
                    <label className="check-pill mt-4">
                      <input type="checkbox" checked={confirmForm} onChange={(event) => setConfirmForm(event.target.checked)} />
                      フォーム送信完了を確認しました
                    </label>
                    <div className="btn-row mt-4">
                      <button className="btn danger" disabled={running || !confirmForm} onClick={handleMarkFormSent}>
                        <CheckCircle2 size={16} />
                        送信済みにする
                      </button>
                    </div>
                    {markSentFeedback && (
                      <p className={markSentFeedback.status === "success" ? "success-box mt-4" : "error-box mt-4"}>{markSentFeedback.text}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "email" && emailResult && (
              <p className={emailResult.status === "success" ? "success-box mt-4" : "error-box mt-4"}>{emailResult.text}</p>
            )}
          </section>
          <section className="form-panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">返信確認</h3>
                <p className="panel-caption">Gmailの返信と面談予約の通知を確認し、スプレッドシートへ反映します（Gmail返信同期）。</p>
              </div>
              <RefreshCw size={20} color="var(--success)" />
            </div>
            <div className="btn-row">
              <button className="btn primary" disabled={running} onClick={() => handleGmailAction({ command: "gmail-sync" })}>
                <RefreshCw size={16} />
                返信を確認して反映
              </button>
            </div>
            {gmailResult && (
              <p className={gmailResult.status === "success" ? "success-box mt-4" : "error-box mt-4"}>
                {gmailResult.text}
              </p>
            )}
            {gmailResult?.items && gmailResult.items.length > 0 && (
              <ul className="mt-4">
                {gmailResult.items.map((item, index) => (
                  <li key={`${item.leadId}-${index}`}>
                    <LeadLink leadId={item.leadId} label={`${item.leadId} ${item.company}`} /> ：
                    {item.type === "booking" ? "面談予約を反映（返信あり）" : item.type === "optout" ? "配信停止・営業お断り → 除外" : item.type === "bounce" ? "メール不達" : item.type === "resend-due" ? "再送の時期になりました" : item.type === "recheck-revived" ? "見送りの再確認 → 送信待ち" : "返信あり"} - {item.detail}
                  </li>
                ))}
              </ul>
            )}
          </section>

        {error && <p className="error-box">{error}</p>}
        </div>

        <CandidatePanel
          tab={tab}
          candidates={candidates}
          selectedIds={selectedIds}
          maxSelect={maxSelect}
          notice={candidateNotice}
          error={candidateError}
          onToggle={toggleCandidate}
          onMemoSave={saveCandidateMemo}
          onStatusChange={changeCandidateStatus}
          onShowMessage={showCandidateMessage}
          onFormUrlChange={changeCandidateFormUrl}
        />
      </div>

      <footer className="actions-footer">
        <button type="button" className="btn secondary" onClick={() => setLogOpen(true)}>
          <ScrollText size={16} />
          ログ
          {watchEntries.filter((entry) => entry.state === "watching").length > 0 && (
            <span className="status-badge waiting">見張り中 {watchEntries.filter((entry) => entry.state === "watching").length}</span>
          )}
        </button>
        <ResultBar job={currentJob} />
      </footer>

      {logOpen && (
        <div className="modal-backdrop" onClick={() => setLogOpen(false)}>
          <div className="modal-panel modal-wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="segmented">
                {([
                  ["watch", "送信完了の自動検知"],
                  ["outcomes", "フォーム送信の結果"],
                  ["jobs", "実行ログ"]
                ] as const).map(([key, label]) => (
                  <button key={key} type="button" className={logTab === key ? "segment active" : "segment"} onClick={() => setLogTab(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <button className="btn secondary icon-only" type="button" onClick={() => setLogOpen(false)} title="閉じる">
                <X size={16} />
              </button>
            </div>
            <div className="modal-log">
              {logTab === "watch" && (
                <>
                  <section className="form-panel">
                    <div className="panel-header">
                      <div>
                        <h3 className="panel-title">送信完了の自動検知</h3>
                        <p className="panel-caption">
                          フォーム入力後に開いたタブを見張り、送信完了画面を検知すると「送信済み」に自動更新します（5秒ごとに更新）。
                        </p>
                      </div>
                      <CheckCircle2 size={20} color="var(--success)" />
                    </div>
                    {watchEntries.length === 0 ? (
                      <p className="panel-caption">見張り中のフォームはありません。</p>
                    ) : (
                      <div className="data-table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>リード</th>
                              <th>状態</th>
                              <th>更新</th>
                              <th>内容</th>
                            </tr>
                          </thead>
                          <tbody>
                            {watchEntries.slice(0, 10).map((entry) => {
                              const label = watchStateLabel(entry.state);

                              return (
                                <tr key={entry.leadId}>
                                  <td>
                                    <LeadLink leadId={entry.leadId} label={`${entry.leadId} ${entry.companyName}`} />
                                  </td>
                                  <td>
                                    <span className={label.className}>{label.text}</span>
                                  </td>
                                  <td>{formatDateTime(entry.updatedAt)}</td>
                                  <td>
                                    {entry.message ?? (entry.state === "watching" ? "送信完了画面を待っています" : "")}
                                    {entry.state === "manual-required" && (
                                      <button
                                        className="btn primary mt-4"
                                        disabled={manualLoading}
                                        onClick={() => {
                                          setTab("form");
                                          setLeadId(entry.leadId);
                                          leadIdFromAutoFill.current = false;
                                          openManualForm(entry.leadId);
                                          window.scrollTo({ top: 0, behavior: "smooth" });
                                        }}
                                      >
                                        自分で入力で開く
                                      </button>
                                    )}
                                    {(entry.state === "needs-confirm" || entry.state === "manual-required") && (
                                      <button
                                        className="btn secondary mt-4"
                                        disabled={running}
                                        onClick={() => handleWatchMarkSent(entry)}
                                      >
                                        送信済みにする
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              )}
              {logTab === "outcomes" && (
                <>
                  <section className="form-panel">
                    <div className="panel-header">
                      <div>
                        <h3 className="panel-title">フォーム送信の結果（直近{outcomeSummary?.periodDays ?? 30}日）</h3>
                        <p className="panel-caption">送信の成功・エラーの傾向です。「送信完了の自動検知」が記録した結果を、集計しています。</p>
                      </div>
                      <CheckCircle2 size={20} color="var(--accent)" />
                    </div>
                    {!outcomeSummary || outcomeSummary.total === 0 ? (
                      <p className="panel-caption">まだ記録がありません。フォームを自動入力して、送信すると、ここに集計されます。</p>
                    ) : (
                      <>
                        <div className="legend">
                          {Object.entries(outcomeSummary.counts).map(([kind, count]) => (
                            <span className="legend-item" key={kind}>
                              <span
                                className="legend-dot"
                                style={{ "--dot": kind === "success" ? "#10b981" : ["spam", "invalid", "failed"].includes(kind) ? "#ef4444" : "#f59e0b" } as CSSProperties}
                              />
                              {OUTCOME_LABELS[kind] ?? kind} {count}
                            </span>
                          ))}
                        </div>
                        {(() => {
                          const success = outcomeSummary.counts.success ?? 0;
                          const errors = (outcomeSummary.counts.spam ?? 0) + (outcomeSummary.counts.invalid ?? 0) + (outcomeSummary.counts.failed ?? 0);
                          return success + errors > 0 ? (
                            <p className="panel-caption mt-4">
                              送信の成功率: {Math.round((success / (success + errors)) * 100)}%（成功{success}件 / エラー{errors}件）
                            </p>
                          ) : null;
                        })()}
                        {outcomeSummary.topProblemDomains.length > 0 && (
                          <p className="panel-caption mt-4">
                            問題が多いサイト: {outcomeSummary.topProblemDomains.map((item) => `${item.domain}（${item.count}件）`).join("、")}
                          </p>
                        )}
                        {outcomeSummary.recentProblems.length > 0 && (
                          <div className="data-table-wrap mt-4">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>日時</th>
                                  <th>リード</th>
                                  <th>結果</th>
                                  <th className="hide-mobile">内容</th>
                                </tr>
                              </thead>
                              <tbody>
                                {outcomeSummary.recentProblems.map((item, index) => (
                                  <tr key={`${item.leadId}-${item.at}-${index}`}>
                                    <td className="cell-nowrap">{formatDateTime(item.at)}</td>
                                    <td>
                                      <LeadLink leadId={item.leadId} label={`${item.leadId} ${item.companyName}`} />
                                    </td>
                                    <td className="cell-nowrap">{OUTCOME_LABELS[item.kind] ?? item.kind}</td>
                                    <td className="hide-mobile">{item.detail ?? ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                </>
              )}
              {logTab === "jobs" && (
                <>
                  <section className="panel">
                    <div className="panel-header">
                      <div>
                        <h3 className="panel-title">実行ログ</h3>
                        <p className="panel-caption">直近のボタン操作を保存しています。</p>
                      </div>
                      <button className="btn secondary" disabled={running} onClick={() => loadJobs()}>
                        <RefreshCw size={16} />
                        更新
                      </button>
                    </div>
                    {jobs.length === 0 ? (
                      <p className="panel-caption">ログはまだありません。</p>
                    ) : (
                      <div className="data-table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>日時</th>
                              <th>操作</th>
                              <th>結果</th>
                              <th className="hide-mobile">コマンド</th>
                            </tr>
                          </thead>
                          <tbody>
                            {jobs.map((job) => (
                              <tr key={job.id}>
                                <td>{formatDateTime(job.startedAt)}</td>
                                <td>{job.label}</td>
                                <td><span className={jobStatusClass(job.status)}>{statusLabel(job.status)}</span></td>
                                <td className="hide-mobile font-mono text-xs">{["npm", ...job.args].join(" ")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <UndoToast toast={undoToast} onUndo={undoCandidateStatus} onClose={() => setUndoToast(null)} />

      <ResultDock watchEntries={watchEntries} watchLoaded={watchLoaded} onOpenLog={() => { setLogTab("watch"); setLogOpen(true); }} />

      {messageModal && (
        <div className="modal-backdrop" onClick={() => setMessageModal(null)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="panel-title">{messageModal.companyName}</h3>
                <p className="panel-caption">{messageModal.leadId} 宛のメッセージ</p>
              </div>
              <button className="btn secondary icon-only" type="button" onClick={() => setMessageModal(null)} title="閉じる">
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
                  <button className="btn primary" type="button" onClick={copyModalMessage}>
                    {messageCopied ? <Check size={16} /> : <Copy size={16} />}
                    {messageCopied ? "コピーしました" : "件名・本文をコピー"}
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
