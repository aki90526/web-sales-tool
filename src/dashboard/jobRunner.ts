import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { parseEmailList } from "../email/emailList";

export type DashboardCommand =
  | "email-dry-run"
  | "email-test"
  | "email-send"
  | "forms-todo"
  | "forms-fill"
  | "forms-mark-sent"
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

export type DashboardJobInput = {
  command: DashboardCommand;
  limit?: unknown;
  leadId?: unknown;
  testTo?: unknown;
  bcc?: unknown;
  note?: unknown;
  confirm?: unknown;
};

const JOBS_PATH = path.resolve(process.cwd(), "data", "dashboard-jobs.json");
const MAX_JOBS = 40;
const MAX_OUTPUT_CHARS = 50000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

let activeJobId: string | null = null;

const asText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const asLimit = (value: unknown, fallback: number, max: number): number => {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`limitは1〜${max}の整数で指定してください`);
  }

  return parsed;
};

const requireConfirmed = (input: DashboardJobInput, action: string): void => {
  if (input.confirm !== true) {
    throw new Error(`${action} は確認チェックが必要です`);
  }
};

const trimOutput = (value: string): string => {
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n... output truncated ...`;
};

const readJobs = async (): Promise<DashboardJob[]> => {
  try {
    const raw = await fs.readFile(JOBS_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DashboardJob[]) : [];
  } catch {
    return [];
  }
};

const writeJobs = async (jobs: DashboardJob[]): Promise<void> => {
  await fs.mkdir(path.dirname(JOBS_PATH), { recursive: true });
  await fs.writeFile(JOBS_PATH, `${JSON.stringify(jobs.slice(0, MAX_JOBS), null, 2)}\n`, "utf8");
};

const saveJob = async (job: DashboardJob): Promise<void> => {
  const jobs = await readJobs();
  const next = [job, ...jobs.filter((entry) => entry.id !== job.id)].slice(0, MAX_JOBS);
  await writeJobs(next);
};

const buildCommand = (input: DashboardJobInput): { label: string; args: string[] } => {
  const limit = asLimit(input.limit, 1, 10);
  const gmailLimit = asLimit(input.limit, 200, 200);
  const leadId = asText(input.leadId);
  const note = asText(input.note);
  const testToList = parseEmailList(asText(input.testTo));
  const bcc = typeof input.bcc === "string" ? parseEmailList(input.bcc) : undefined;

  switch (input.command) {
    case "email-dry-run":
      return {
        label: `メール dry-run ${limit}件`,
        args: ["run", "send:emails", "--", "--dry-run", "--limit", String(limit)]
      };

    case "email-test":
      if (testToList.length === 0) {
        throw new Error("テスト送信先メールアドレスを入力してください");
      }
      return {
        label: `メールテスト送信 ${limit}件`,
        args: ["run", "send:emails", "--", "--test-to", testToList.join(","), "--limit", String(limit)]
      };

    case "email-send":
      requireConfirmed(input, "メール本送信");
      return {
        label: `メール本送信 ${limit}件`,
        args: [
          "run",
          "send:emails",
          "--",
          "--limit",
          String(limit),
          ...(bcc === undefined ? [] : bcc.length > 0 ? ["--bcc", bcc.join(",")] : ["--no-bcc"])
        ]
      };

    case "forms-todo":
      return {
        label: `フォーム対象確認 ${limit}件`,
        args: ["run", "forms:todo", "--", "--limit", String(limit)]
      };

    case "forms-fill":
      return {
        label: leadId ? `フォーム自動入力 ${leadId}` : `フォーム自動入力 ${limit}件`,
        args: leadId
          ? ["run", "forms:fill", "--", "--lead-id", leadId]
          : ["run", "forms:fill", "--", "--limit", String(Math.min(limit, 5))]
      };

    case "forms-mark-sent":
      requireConfirmed(input, "フォーム送信済み更新");
      return {
        label: leadId ? `フォーム送信済み更新 ${leadId}` : "フォーム送信済み更新",
        args: [
          "run",
          "forms:mark-sent",
          "--",
          ...(leadId ? ["--lead-id", leadId] : []),
          ...(note ? ["--note", note] : [])
        ]
      };

    case "gmail-sync":
      return {
        label: `Gmail返信同期 ${gmailLimit}件`,
        args: ["run", "gmail:sync-replies", "--", "--limit", String(gmailLimit)]
      };

    default:
      throw new Error("未対応の操作です");
  }
};

const npmCommand = (): string => (process.platform === "win32" ? "npm.cmd" : "npm");

const execute = (args: string[]): Promise<{ stdout: string; stderr: string; exitCode?: number | string }> => {
  return new Promise((resolve, reject) => {
    execFile(
      npmCommand(),
      args,
      {
        cwd: process.cwd(),
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const errorWithOutput = error as Error & { code?: number | string; signal?: string; stdout?: string; stderr?: string };
          reject({
            error,
            stdout: stdout || errorWithOutput.stdout || "",
            stderr: stderr || errorWithOutput.stderr || error.message,
            exitCode: errorWithOutput.code ?? errorWithOutput.signal ?? "error"
          });
          return;
        }

        resolve({ stdout, stderr, exitCode: 0 });
      }
    );
  });
};

const parseCaptchaDetections = (stdout: string): CaptchaDetection[] => {
  const pattern = /\[DASHBOARD_CAPTCHA\] leadId=(\S+) label=(.+)/g;
  const detections: CaptchaDetection[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stdout)) !== null) {
    detections.push({ leadId: match[1], label: match[2].trim() });
  }

  return detections;
};

const parseFilledLeads = (stdout: string): FilledLead[] => {
  const pattern = /\[DASHBOARD_LEAD\] leadId=(\S+) companyName=(.+)/g;
  const leads: FilledLead[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stdout)) !== null) {
    leads.push({ leadId: match[1], companyName: match[2].trim() });
  }

  return leads;
};

const parseConfirmedLeadIds = (stdout: string): string[] => {
  const pattern = /\[DASHBOARD_CONFIRM\] leadId=(\S+) status=advanced/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stdout)) !== null) {
    ids.push(match[1]);
  }

  return ids;
};

const parseFillWarnings = (stdout: string): Array<{ leadId: string; message: string }> => {
  const pattern = /\[DASHBOARD_WARNING\] leadId=(\S+) message=(.+)/g;
  const warnings: Array<{ leadId: string; message: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stdout)) !== null) {
    warnings.push({ leadId: match[1], message: match[2].trim() });
  }

  return warnings;
};

const parseUpdates = (stdout: string): Array<{ leadId: string; company: string; type: string; detail: string }> => {
  const pattern = /\[DASHBOARD_UPDATE\] leadId=(\S+) company=(.*?) type=(\S+) detail=(.+)/g;
  const updates: Array<{ leadId: string; company: string; type: string; detail: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stdout)) !== null) {
    updates.push({ leadId: match[1], company: match[2].trim(), type: match[3], detail: match[4].trim() });
  }

  return updates;
};

const parseResultSummary = (stdout: string): { count: number; mode: string } | null => {
  const match = /\[DASHBOARD_SUMMARY\] count=(\d+) mode=(\S+)/.exec(stdout);
  if (!match) {
    return null;
  }

  return { count: Number(match[1]), mode: match[2] };
};

export const listDashboardJobs = async (): Promise<{ jobs: DashboardJob[]; activeJobId: string | null }> => {
  return {
    jobs: await readJobs(),
    activeJobId
  };
};

export const runDashboardJob = async (input: DashboardJobInput): Promise<DashboardJob> => {
  if (activeJobId) {
    throw new Error("別の処理が実行中です。完了してから再実行してください。");
  }

  const command = input.command;
  const { label, args } = buildCommand(input);
  const job: DashboardJob = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    command,
    label,
    status: "running",
    startedAt: new Date().toISOString(),
    args,
    stdout: "",
    stderr: ""
  };

  activeJobId = job.id;
  await saveJob(job);

  try {
    const result = await execute(args);
    job.status = "success";
    job.exitCode = result.exitCode;
    if (command === "forms-fill") {
      const detections = parseCaptchaDetections(result.stdout);
      if (detections.length > 0) {
        job.captchaDetections = detections;
      }
      const filledLeads = parseFilledLeads(result.stdout);
      if (filledLeads.length > 0) {
        job.filledLeads = filledLeads;
      }
      const fillWarnings = parseFillWarnings(result.stdout);
      if (fillWarnings.length > 0) {
        job.fillWarnings = fillWarnings;
      }
      const confirmedLeadIds = parseConfirmedLeadIds(result.stdout);
      if (confirmedLeadIds.length > 0) {
        job.confirmedLeadIds = confirmedLeadIds;
      }
    }
    const updates = parseUpdates(result.stdout);
    if (updates.length > 0) {
      job.updates = updates;
    }
    const summary = parseResultSummary(result.stdout);
    if (summary) {
      job.resultCount = summary.count;
      job.resultMode = summary.mode;
    }
    job.stdout = trimOutput(result.stdout);
    job.stderr = trimOutput(result.stderr);
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; exitCode?: number | string };
    job.status = "failed";
    job.exitCode = failed.exitCode ?? "error";
    job.stdout = trimOutput(failed.stdout ?? "");
    job.stderr = trimOutput(failed.stderr ?? "処理に失敗しました");
  } finally {
    job.finishedAt = new Date().toISOString();
    activeJobId = null;
    await saveJob(job);
  }

  return job;
};
