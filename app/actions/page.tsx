"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, CheckCircle2, ClipboardCheck, Copy, Mail, MousePointerClick, RefreshCw, Send, ShieldCheck } from "lucide-react";

type DashboardCommand =
  | "email-dry-run"
  | "email-test"
  | "email-send"
  | "forms-todo"
  | "forms-fill"
  | "forms-mark-sent"
  | "gmail-sync";

type CaptchaDetection = {
  leadId: string;
  label: string;
};

type FilledLead = {
  leadId: string;
  companyName: string;
};

type DashboardJob = {
  id: string;
  command: DashboardCommand;
  label: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | string;
  args: string[];
  stdout: string;
  stderr: string;
  captchaDetections?: CaptchaDetection[];
  filledLeads?: FilledLead[];
  confirmedLeadIds?: string[];
  fillWarnings?: Array<{ leadId: string; message: string }>;
  updates?: Array<{ leadId: string; company: string; type: string; detail: string }>;
  resultCount?: number;
  resultMode?: string;
};

type FormWatchEntry = {
  leadId: string;
  companyName: string;
  state: "watching" | "needs-confirm" | "manual-required" | "submit-error" | "recorded" | "already-recorded" | "failed" | "closed" | "timeout";
  startedAt: string;
  updatedAt: string;
  message?: string;
};

type FormOutcomeSummary = {
  periodDays: number;
  total: number;
  counts: Partial<Record<string, number>>;
  topProblemDomains: Array<{ domain: string; count: number }>;
  recentProblems: Array<{ at: string; leadId: string; companyName: string; domain: string; kind: string; detail?: string }>;
};

const OUTCOME_LABELS: Record<string, string> = {
  success: "送信成功",
  spam: "スパム判定",
  invalid: "入力エラー",
  failed: "送信失敗",
  captcha: "CAPTCHA",
  "wrong-page": "本物のフォームでない",
  "needs-confirm": "送信後に要確認",
  closed: "タブが閉じられた",
  timeout: "結果を検知できず"
};

const watchStateLabel = (state: FormWatchEntry["state"]): { text: string; className: string } => {
  switch (state) {
    case "watching":
      return { text: "見張り中", className: "status-badge waiting" };
    case "manual-required":
      return { text: "手動送信が必要（スパム判定）", className: "status-badge reply" };
    case "submit-error":
      return { text: "フォームが送信エラー", className: "status-badge" };
    case "needs-confirm":
      return { text: "要確認（送信後にトップへ転送）", className: "status-badge reply" };
    case "recorded":
      return { text: "自動で送信済みに更新", className: "status-badge sent" };
    case "already-recorded":
      return { text: "記録済み", className: "status-badge sent" };
    case "failed":
      return { text: "記録に失敗", className: "status-badge" };
    case "timeout":
      return { text: "検知できず終了", className: "status-badge reply" };
    default:
      return { text: "見張り終了", className: "status-badge reply" };
  }
};

type JobRequest = {
  command: DashboardCommand;
  limit?: number;
  leadId?: string;
  testTo?: string;
  bcc?: string;
  note?: string;
  confirm?: boolean;
};

const statusLabel = (status: DashboardJob["status"]): string => {
  if (status === "success") return "成功";
  if (status === "failed") return "失敗";
  return "実行中";
};

const jobStatusClass = (status: DashboardJob["status"]): string => {
  if (status === "success") return "status-badge sent";
  if (status === "failed") return "status-badge";
  return "status-badge waiting";
};

const formatDateTime = (value: string): string => new Date(value).toLocaleString("ja-JP");

function LeadLink({ leadId, label }: { leadId: string; label?: string }) {
  return (
    <a
      className="text-[var(--accent)] hover:underline"
      href={`/leads?leadId=${encodeURIComponent(leadId)}`}
      target="_blank"
      rel="noreferrer"
      title="リード一覧で開く（別タブ）"
    >
      {label ?? leadId}
    </a>
  );
}

const buildResultMessage = (job: DashboardJob): string => {
  const count = job.resultCount ?? 0;

  switch (job.command) {
    case "email-dry-run":
      return `送信対象を${count}件確認しました（dry-run、実際には送信していません）。`;
    case "email-test":
      return `テストメールを${count}件送信しました。`;
    case "email-send":
      return `本メールを${count}件送信しました。`;
    case "forms-todo":
      return `フォーム送信対象を${count}件確認しました。`;
    case "gmail-sync":
      return count === 0 ? "新しい返信・面談予約は見つかりませんでした。" : `返信・面談予約を${count}件、シートに反映しました。`;
    default:
      return "処理が完了しました。";
  }
};

const outputText = (job: DashboardJob): string => {
  return [job.stdout, job.stderr && `STDERR:\n${job.stderr}`].filter(Boolean).join("\n\n").trim();
};

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
  const [formMode, setFormMode] = useState<"auto" | "manual">("auto");
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
    }
  };

  const handleAutoFill = async () => {
    setCaptchaWarning(null);
    setAutoFillResult(null);
    setConfirmedLeadIds([]);
    setFillWarnings([]);
    // 前回の自動入力で自動的に入ったリードIDは、送信済みで対象外になっているため使わず、次の対象を自動選択する
    const targetLeadId = leadIdFromAutoFill.current ? "" : leadId;
    const job = await runJob({ command: "forms-fill", limit, leadId: targetLeadId });
    setConfirmedLeadIds(job?.confirmedLeadIds ?? []);
    setFillWarnings(job?.fillWarnings ?? []);

    if (job?.status === "failed") {
      const reason = (job.stderr || job.stdout || "").trim().split("\n").filter(Boolean).slice(-1)[0];
      setError(`自動入力に失敗しました: ${reason || "原因不明（下のログを確認してください）"}`);
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
      if (!trimmedLeadId) {
        setLeadId(body.leadId);
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
    setFormMode("manual");
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
    const job = await runJob(request);

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
    const job = await runJob({ command: "forms-todo", limit });

    if (!job) return;

    if (job.status === "success") {
      setFormsTodoResult({ status: "success", text: buildResultMessage(job) });
    } else {
      setFormsTodoResult({ status: "failed", text: job.stderr || job.stdout || "処理に失敗しました。" });
    }
  };

  const overlayMessage = running ? "処理を実行しています..." : manualLoading ? "読み込み中です..." : null;

  return (
    <div className="page-stack">
      {overlayMessage && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-overlay-box">
            <span className="loading-spinner" />
            <p>{overlayMessage}</p>
          </div>
        </div>
      )}
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
        <article className="kpi-card" style={{ "--card-color": "#2f6df6", "--card-bg": "#dbeafe" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>送信待ち（メール）</span>
            <span className="kpi-icon"><Mail size={19} /></span>
          </div>
          <div className="kpi-value">{targetCounts ? targetCounts.email : "-"}</div>
          <span className="kpi-note">今すぐ送信できる件数</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#f59e0b", "--card-bg": "#fef3c7" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>送信待ち（フォーム）</span>
            <span className="kpi-icon"><MousePointerClick size={19} /></span>
          </div>
          <div className="kpi-value">{targetCounts ? targetCounts.form : "-"}</div>
          <span className="kpi-note">
            {targetCounts ? `自動入力できる${targetCounts.formAuto}件 / 手動のみ${targetCounts.formManualOnly}件` : "読み込み中"}
          </span>
        </article>
      </section>

      <section className="form-panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">共通設定</h3>
            <p className="panel-caption">実行件数は本送信前に必ず小さく確認してください。</p>
          </div>
          <ShieldCheck size={20} color="var(--accent)" />
        </div>
        <div className="field-grid">
          <label className="field">
            件数
            <input type="number" min={1} max={10} value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
          </label>
        </div>
      </section>

      <section className="split-grid">
        <div className="form-panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">メール</h3>
              <p className="panel-caption">dry-run、テスト送信、本送信を実行します。</p>
            </div>
            <Mail size={20} color="var(--accent)" />
          </div>
          <div className="btn-row">
            <button className="btn secondary" disabled={running} onClick={() => handleEmailAction({ command: "email-dry-run", limit })}>
              <ClipboardCheck size={16} />
              dry-run
            </button>
          </div>
          <label className="field mt-4">
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
              disabled={running}
              onClick={() => handleEmailAction({ command: "email-test", limit, testTo: emailTestTo })}
            >
              <Mail size={16} />
              テスト送信
            </button>
          </div>
          <label className="field mt-4">
            本送信のBCC（複数はカンマ区切り、空欄でBCCなし）
            <input
              value={emailBcc}
              onChange={(event) => setEmailBcc(event.target.value)}
              placeholder="BCCなし"
            />
          </label>
          <label className="check-pill mt-4">
            <input type="checkbox" checked={confirmEmail} onChange={(event) => setConfirmEmail(event.target.checked)} />
            本送信する内容を確認しました
          </label>
          <div className="btn-row mt-4">
            <button
              className="btn danger"
              disabled={running || !confirmEmail}
              onClick={() => handleEmailAction({ command: "email-send", limit, bcc: emailBcc, confirm: confirmEmail })}
            >
              <Send size={16} />
              メール本送信
            </button>
          </div>
          {emailResult && (
            <p className={emailResult.status === "success" ? "success-box mt-4" : "error-box mt-4"}>
              {emailResult.text}
            </p>
          )}
        </div>

        <div className="form-panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">フォーム</h3>
              <p className="panel-caption">Mac側Chromeで自動入力するか、フォームを開いて自分で入力します。</p>
            </div>
            <MousePointerClick size={20} color="var(--warning)" />
          </div>
          <div className="btn-row">
            <button className="btn secondary" disabled={running} onClick={handleFormsTodo}>
              <ClipboardCheck size={16} />
              対象確認
            </button>
          </div>
          {formsTodoResult && (
            <p className={formsTodoResult.status === "success" ? "success-box mt-4" : "error-box mt-4"}>
              {formsTodoResult.text}
            </p>
          )}
          <label className="field mt-4">
            リードID
            <input
              value={leadId}
              onChange={(event) => {
                setLeadId(event.target.value);
                leadIdFromAutoFill.current = false;
              }}
              placeholder="空欄なら次の対象を自動選択"
            />
          </label>
          {leadId.trim() && (
            <a
              className="text-[var(--accent)] hover:underline mt-4"
              href={`/leads?leadId=${encodeURIComponent(leadId.trim())}`}
              target="_blank"
              rel="noreferrer"
            >
              このリードをリード一覧で確認・編集する →
            </a>
          )}
          <div className="segmented mt-4">
            <button
              type="button"
              className={formMode === "auto" ? "segment active" : "segment"}
              onClick={() => setFormMode("auto")}
            >
              自動入力
            </button>
            <button
              type="button"
              className={formMode === "manual" ? "segment active" : "segment"}
              onClick={() => setFormMode("manual")}
            >
              自分で入力
            </button>
          </div>

          {formMode === "auto" ? (
            <>
              <div className="btn-row mt-4">
                <button className="btn primary" disabled={running} onClick={handleAutoFill}>
                  <MousePointerClick size={16} />
                  自動入力を開く
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
                      自分で入力に切り替える
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="btn-row mt-4">
                <button className="btn primary" disabled={manualLoading} onClick={() => openManualForm()}>
                  <MousePointerClick size={16} />
                  フォームを開く
                </button>
              </div>
              {manualLoading && <p className="panel-caption mt-4">読み込み中...</p>}
              {manualError && <p className="error-box mt-4">{manualError}</p>}
              {manualMessage && (
                <>
                  <label className="field full mt-4">
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
                </>
              )}
            </>
          )}
          <label className="field mt-4">
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
            <p className={markSentFeedback.status === "success" ? "success-box mt-4" : "error-box mt-4"}>
              {markSentFeedback.text}
            </p>
          )}
        </div>
      </section>

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
                              setFormMode("manual");
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

      <section className="form-panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">Gmail返信同期</h3>
            <p className="panel-caption">Gmailの返信と面談予約の通知を確認し、スプレッドシートへ反映します。</p>
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
                {item.type === "booking" ? "面談予約を反映（返信あり）" : item.type === "optout" ? "配信停止・営業お断り → 除外" : "返信あり"} - {item.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="error-box">{error}</p>}

      {currentJob && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">直近の実行結果</h3>
              <p className="panel-caption">
                {currentJob.label} / {statusLabel(currentJob.status)} / {formatDateTime(currentJob.startedAt)}
              </p>
            </div>
          </div>
          <pre className="log-output">{outputText(currentJob) || "出力はありません。"}</pre>
        </section>
      )}

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
    </div>
  );
}
