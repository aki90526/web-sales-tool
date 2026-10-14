import fs from "fs";
import path from "path";

export type FormWatchState = "watching" | "needs-confirm" | "manual-required" | "submit-error" | "recorded" | "already-recorded" | "failed" | "closed" | "timeout";

export type FormWatchEntry = {
  leadId: string;
  companyName: string;
  state: FormWatchState;
  startedAt: string;
  updatedAt: string;
  // 見張りの処理が生きている間、定期的に更新される
  heartbeatAt: string;
  message?: string;
};

const statusPath = path.resolve(process.cwd(), "data", "form-watch-status.json");
const MAX_ENTRIES = 60;

export const readFormWatchStatus = (): FormWatchEntry[] => {
  try {
    const parsed = JSON.parse(fs.readFileSync(statusPath, "utf8")) as unknown;

    return Array.isArray(parsed) ? (parsed as FormWatchEntry[]) : [];
  } catch {
    return [];
  }
};

const writeFormWatchStatus = (entries: FormWatchEntry[]): void => {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const tempPath = `${statusPath}.${process.pid}.tmp`;

  fs.writeFileSync(tempPath, `${JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, statusPath);
};

export const upsertFormWatchEntry = (
  leadId: string,
  companyName: string,
  patch: Partial<Pick<FormWatchEntry, "state" | "message">> & { startedAt?: string }
): void => {
  const now = new Date().toISOString();
  const entries = readFormWatchStatus();
  const existing = entries.find((entry) => entry.leadId === leadId);
  const next: FormWatchEntry = {
    leadId,
    companyName,
    state: patch.state ?? existing?.state ?? "watching",
    startedAt: patch.startedAt ?? existing?.startedAt ?? now,
    updatedAt: now,
    heartbeatAt: now,
    message: patch.message ?? (patch.state ? undefined : existing?.message)
  };

  writeFormWatchStatus([next, ...entries.filter((entry) => entry.leadId !== leadId)]);
};

export const touchFormWatchHeartbeat = (leadIds: string[]): void => {
  const now = new Date().toISOString();
  const entries = readFormWatchStatus().map((entry) =>
    leadIds.includes(entry.leadId) && entry.state === "watching" ? { ...entry, heartbeatAt: now } : entry
  );

  writeFormWatchStatus(entries);
};
