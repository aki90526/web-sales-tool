"use client";

import { useEffect, useState } from "react";

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

const formatDateTime = (value: string): string => {
  return new Date(value).toLocaleString("ja-JP");
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

  const buttonClass =
    "rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50";
  const secondaryButtonClass =
    "rounded border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50";
  const dangerButtonClass =
    "rounded bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
  const inputClass = "rounded border border-[var(--border)] bg-transparent px-2 py-2";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">実行操作</h2>
          <span className="text-sm text-[var(--muted)]">
            {running || activeJobId ? "処理中です" : "実行可能です"}
          </span>
        </div>

        <label className="flex max-w-[180px] flex-col gap-1 text-sm">
          件数
          <input
            className={inputClass}
            type="number"
            min={1}
            max={10}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          />
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="font-semibold">メール</h2>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryButtonClass} disabled={running} onClick={() => runJob({ command: "email-dry-run", limit })}>
            dry-run
          </button>
          <button
            className={secondaryButtonClass}
            disabled={running}
            onClick={() => runJob({ command: "email-test", limit, testTo: emailTestTo })}
          >
            テスト送信
          </button>
        </div>
        <label className="flex max-w-[360px] flex-col gap-1 text-sm">
          テスト送信先
          <input className={inputClass} value={emailTestTo} onChange={(event) => setEmailTestTo(event.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmEmail} onChange={(event) => setConfirmEmail(event.target.checked)} />
          本送信する内容を確認しました
        </label>
        <button
          className={dangerButtonClass}
          disabled={running || !confirmEmail}
          onClick={() => runJob({ command: "email-send", limit, confirm: confirmEmail })}
        >
          メール本送信
        </button>
      </section>

      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="font-semibold">問い合わせフォーム</h2>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryButtonClass} disabled={running} onClick={() => runJob({ command: "forms-todo", limit })}>
            対象確認
          </button>
          <button
            className={buttonClass}
            disabled={running}
            onClick={() => runJob({ command: "forms-fill", limit, leadId })}
          >
            自動入力を開く
          </button>
        </div>
        <label className="flex max-w-[260px] flex-col gap-1 text-sm">
          リードID
          <input
            className={inputClass}
            value={leadId}
            onChange={(event) => setLeadId(event.target.value)}
            placeholder="空欄なら先頭から実行"
          />
        </label>
        <label className="flex max-w-[520px] flex-col gap-1 text-sm">
          送信済みメモ
          <input
            className={inputClass}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例: ダッシュボードから手動フォーム送信済み"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmForm} onChange={(event) => setConfirmForm(event.target.checked)} />
          フォーム送信完了を確認しました
        </label>
        <button
          className={dangerButtonClass}
          disabled={running || !confirmForm}
          onClick={() => runJob({ command: "forms-mark-sent", leadId, note, confirm: confirmForm })}
        >
          送信済みにする
        </button>
      </section>

      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="font-semibold">Gmail返信同期</h2>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryButtonClass} disabled={running} onClick={() => runJob({ command: "gmail-dry-run", limit })}>
            返信確認 dry-run
          </button>
          <button
            className={dangerButtonClass}
            disabled={running || !confirmGmail}
            onClick={() => runJob({ command: "gmail-sync", limit, confirm: confirmGmail })}
          >
            返信ありを反映
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmGmail} onChange={(event) => setConfirmGmail(event.target.checked)} />
          Gmail同期結果をスプレッドシートへ反映します
        </label>
      </section>

      {error && <p className="rounded border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{error}</p>}

      {currentJob && (
        <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
          <h2 className="font-semibold">直近の実行結果</h2>
          <p className="text-sm">
            {currentJob.label} / {statusLabel(currentJob.status)} / {formatDateTime(currentJob.startedAt)}
          </p>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded bg-black p-3 text-xs text-white">
            {outputText(currentJob) || "出力はありません。"}
          </pre>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">実行ログ</h2>
          <button className={secondaryButtonClass} disabled={running} onClick={() => loadJobs()}>
            更新
          </button>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">ログはまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="px-2 py-1">日時</th>
                  <th className="px-2 py-1">操作</th>
                  <th className="px-2 py-1">結果</th>
                  <th className="px-2 py-1">コマンド</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-[var(--border)] align-top">
                    <td className="px-2 py-1 whitespace-nowrap">{formatDateTime(job.startedAt)}</td>
                    <td className="px-2 py-1">{job.label}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{statusLabel(job.status)}</td>
                    <td className="px-2 py-1 font-mono text-xs">{["npm", ...job.args].join(" ")}</td>
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
