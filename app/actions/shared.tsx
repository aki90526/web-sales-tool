export type DashboardCommand =
  | "email-dry-run"
  | "email-test"
  | "email-send"
  | "forms-todo"
  | "forms-fill"
  | "forms-mark-sent"
  | "lead-set-status"
  | "gmail-sync";

export type CaptchaDetection = {
  leadId: string;
  label: string;
};

export type FilledLead = {
  leadId: string;
  companyName: string;
};

export type DashboardJob = {
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

export type FormWatchEntry = {
  leadId: string;
  companyName: string;
  state: "watching" | "needs-confirm" | "manual-required" | "submit-error" | "recorded" | "already-recorded" | "failed" | "closed" | "timeout";
  startedAt: string;
  updatedAt: string;
  message?: string;
};

export type FormOutcomeSummary = {
  periodDays: number;
  total: number;
  counts: Partial<Record<string, number>>;
  topProblemDomains: Array<{ domain: string; count: number }>;
  recentProblems: Array<{ at: string; leadId: string; companyName: string; domain: string; kind: string; detail?: string }>;
};

export const OUTCOME_LABELS: Record<string, string> = {
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

export const watchStateLabel = (state: FormWatchEntry["state"]): { text: string; className: string } => {
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

export type JobRequest = {
  command: DashboardCommand;
  limit?: number;
  leadId?: string;
  leadIds?: string[];
  testTo?: string;
  bcc?: string;
  note?: string;
  status?: string;
  confirm?: boolean;
};

export const statusLabel = (status: DashboardJob["status"]): string => {
  if (status === "success") return "成功";
  if (status === "failed") return "失敗";
  return "実行中";
};

export const jobStatusClass = (status: DashboardJob["status"]): string => {
  if (status === "success") return "status-badge sent";
  if (status === "failed") return "status-badge";
  return "status-badge waiting";
};

export const formatDateTime = (value: string): string => new Date(value).toLocaleString("ja-JP");

export function LeadLink({ leadId, label }: { leadId: string; label?: string }) {
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

export const buildResultMessage = (job: DashboardJob): string => {
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

export const outputText = (job: DashboardJob): string => {
  return [job.stdout, job.stderr && `STDERR:\n${job.stderr}`].filter(Boolean).join("\n\n").trim();
};

