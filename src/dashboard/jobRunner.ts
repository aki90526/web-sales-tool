import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";

export type DashboardCommand =
  | "email-dry-run"
  | "email-test"
  | "email-send"
  | "forms-todo"
  | "forms-fill"
  | "forms-mark-sent"
  | "gmail-dry-run"
  | "gmail-sync";

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
};

export type DashboardJobInput = {
  command: DashboardCommand;
  limit?: unknown;
  leadId?: unknown;
  testTo?: unknown;
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

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

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
  const leadId = asText(input.leadId);
  const note = asText(input.note);
  const testTo = asText(input.testTo);

  switch (input.command) {
    case "email-dry-run":
      return {
        label: `メール dry-run ${limit}件`,
        args: ["run", "send:emails", "--", "--dry-run", "--limit", String(limit)]
      };

    case "email-test":
      if (!testTo || !isValidEmail(testTo)) {
        throw new Error("テスト送信先メールアドレスを正しく入力してください");
      }
      return {
        label: `メールテスト送信 ${limit}件`,
        args: ["run", "send:emails", "--", "--test-to", testTo, "--limit", String(limit)]
      };

    case "email-send":
      requireConfirmed(input, "メール本送信");
      return {
        label: `メール本送信 ${limit}件`,
        args: ["run", "send:emails", "--", "--limit", String(limit)]
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

    case "gmail-dry-run":
      return {
        label: `Gmail返信確認 dry-run ${limit}件`,
        args: ["run", "gmail:sync-replies", "--", "--dry-run", "--limit", String(limit)]
      };

    case "gmail-sync":
      requireConfirmed(input, "Gmail返信同期");
      return {
        label: `Gmail返信同期 ${limit}件`,
        args: ["run", "gmail:sync-replies", "--", "--limit", String(limit)]
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
