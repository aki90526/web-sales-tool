"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Mail, MousePointerClick, RefreshCw, Send, ShieldCheck } from "lucide-react";

type DashboardCommand =
  | "email-dry-run"
  | "email-test"
  | "email-send"
  | "forms-todo"
  | "forms-fill"
  | "forms-mark-sent"
  | "gmail-dry-run"
  | "gmail-sync";

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
  const [confirmGmail, setConfirmGmail] = useState(false);
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

  const runJob = async (request: JobRequest) => {
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
      setCurrentJob(body.job as DashboardJob);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "実行に失敗しました");
      await loadJobs().catch(() => undefined);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page-stack">
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

      <section className="dashboard-grid">
        <div className="form-panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">メール</h3>
              <p className="panel-caption">dry-run、テスト送信、本送信を実行します。</p>
            </div>
            <Mail size={20} color="var(--accent)" />
          </div>
          <div className="btn-row">
            <button className="btn secondary" disabled={running} onClick={() => runJob({ command: "email-dry-run", limit })}>
              <ClipboardCheck size={16} />
              dry-run
            </button>
            <button className="btn secondary" disabled={running} onClick={() => runJob({ command: "email-test", limit, testTo: emailTestTo })}>
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
            <button className="btn danger" disabled={running || !confirmEmail} onClick={() => runJob({ command: "email-send", limit, confirm: confirmEmail })}>
              <Send size={16} />
              メール本送信
            </button>
          </div>
        </div>

        <div className="form-panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">問い合わせフォーム</h3>
              <p className="panel-caption">Mac側Chromeにフォームを開いて自動入力します。</p>
            </div>
            <MousePointerClick size={20} color="var(--warning)" />
          </div>
          <div className="btn-row">
            <button className="btn secondary" disabled={running} onClick={() => runJob({ command: "forms-todo", limit })}>
              <ClipboardCheck size={16} />
              対象確認
            </button>
            <button className="btn primary" disabled={running} onClick={() => runJob({ command: "forms-fill", limit, leadId })}>
              <MousePointerClick size={16} />
              自動入力を開く
            </button>
          </div>
          <label className="field mt-4">
            リードID
            <input value={leadId} onChange={(event) => setLeadId(event.target.value)} placeholder="空欄なら先頭から実行" />
          </label>
          <label className="field mt-4">
            送信済みメモ
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例: ダッシュボードから手動フォーム送信済み" />
          </label>
          <label className="check-pill mt-4">
            <input type="checkbox" checked={confirmForm} onChange={(event) => setConfirmForm(event.target.checked)} />
            フォーム送信完了を確認しました
          </label>
          <div className="btn-row mt-4">
            <button className="btn danger" disabled={running || !confirmForm} onClick={() => runJob({ command: "forms-mark-sent", leadId, note, confirm: confirmForm })}>
              <CheckCircle2 size={16} />
              送信済みにする
            </button>
          </div>
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
          <button className="btn secondary" disabled={running} onClick={() => runJob({ command: "gmail-dry-run", limit })}>
            <ClipboardCheck size={16} />
            返信確認 dry-run
          </button>
          <button className="btn danger" disabled={running || !confirmGmail} onClick={() => runJob({ command: "gmail-sync", limit, confirm: confirmGmail })}>
            <RefreshCw size={16} />
            返信ありを反映
          </button>
        </div>
        <label className="check-pill mt-4">
          <input type="checkbox" checked={confirmGmail} onChange={(event) => setConfirmGmail(event.target.checked)} />
          Gmail同期結果をスプレッドシートへ反映します
        </label>
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
                  <th>コマンド</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{formatDateTime(job.startedAt)}</td>
                    <td>{job.label}</td>
                    <td><span className={jobStatusClass(job.status)}>{statusLabel(job.status)}</span></td>
                    <td className="font-mono text-xs">{["npm", ...job.args].join(" ")}</td>
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
