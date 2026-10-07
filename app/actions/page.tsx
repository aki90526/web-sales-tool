"use client";

import { useEffect, useState } from "react";
import { Check, CheckCircle2, ClipboardCheck, Copy, Mail, MousePointerClick, RefreshCw, Send, ShieldCheck } from "lucide-react";

type DashboardCommand =
  | "email-dry-run"
  | "email-test"
  | "email-send"
  | "forms-todo"
  | "forms-fill"
  | "forms-mark-sent"
  | "gmail-dry-run"
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
  resultCount?: number;
  resultMode?: string;
};

type JobRequest = {
  command: DashboardCommand;
  limit?: number;
  leadId?: string;
  testTo?: string;
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
    case "gmail-dry-run":
      return `返信を${count}件確認しました（dry-run、シートは更新していません）。`;
    case "gmail-sync":
      return `返信を${count}件シートに反映しました。`;
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
  const [leadId, setLeadId] = useState("");
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
  const [confirmGmail, setConfirmGmail] = useState(false);
  const [emailResult, setEmailResult] = useState<{ status: "success" | "failed"; text: string } | null>(null);
  const [gmailResult, setGmailResult] = useState<{ status: "success" | "failed"; text: string } | null>(null);
  const [formsTodoResult, setFormsTodoResult] = useState<{ status: "success" | "failed"; text: string } | null>(
    null
  );
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
  };

  useEffect(() => {
    loadJobs().catch(() => undefined);
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
    const job = await runJob({ command: "forms-fill", limit, leadId });

    if (job?.filledLeads && job.filledLeads.length > 0) {
      setAutoFillResult(job.filledLeads);
      setLeadId(job.filledLeads[0].leadId);
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
      setGmailResult({ status: "success", text: buildResultMessage(job) });
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
            テスト送信先
            <input value={emailTestTo} onChange={(event) => setEmailTestTo(event.target.value)} />
          </label>
          <label className="check-pill mt-4">
            <input type="checkbox" checked={confirmEmail} onChange={(event) => setConfirmEmail(event.target.checked)} />
            本送信する内容を確認しました
          </label>
          <div className="btn-row mt-4">
            <button
              className="btn danger"
              disabled={running || !confirmEmail}
              onClick={() => handleEmailAction({ command: "email-send", limit, confirm: confirmEmail })}
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
              onChange={(event) => setLeadId(event.target.value)}
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
                  <p>{autoFillResult.length}件のフォームを開いてタブに入力しました。内容を確認して送信してください。</p>
                  <ul className="mt-4">
                    {autoFillResult.map((lead) => (
                      <li key={lead.leadId}>
                        {lead.leadId} {lead.companyName}
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
            <h3 className="panel-title">Gmail返信同期</h3>
            <p className="panel-caption">返信検知を確認し、必要に応じてスプレッドシートへ反映します。</p>
          </div>
          <RefreshCw size={20} color="var(--success)" />
        </div>
        <div className="btn-row">
          <button className="btn secondary" disabled={running} onClick={() => handleGmailAction({ command: "gmail-dry-run" })}>
            <ClipboardCheck size={16} />
            返信確認 dry-run
          </button>
          <button
            className="btn danger"
            disabled={running || !confirmGmail}
            onClick={() => handleGmailAction({ command: "gmail-sync", confirm: confirmGmail })}
          >
            <RefreshCw size={16} />
            返信ありを反映
          </button>
        </div>
        <label className="check-pill mt-4">
          <input type="checkbox" checked={confirmGmail} onChange={(event) => setConfirmGmail(event.target.checked)} />
          Gmail同期結果をスプレッドシートへ反映します
        </label>
        {gmailResult && (
          <p className={gmailResult.status === "success" ? "success-box mt-4" : "error-box mt-4"}>
            {gmailResult.text}
          </p>
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
