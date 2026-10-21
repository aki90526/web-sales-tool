import { promises as fs } from "fs";
import os from "os";
import path from "path";

// 本送信が同時に複数走らないようにするロックファイル（ダッシュボードと CLI、別インスタンスの両方を対象にする）
const DEFAULT_LOCK_PATH = path.join(os.tmpdir(), "web-sales-tool-send-emails.lock");
const LOCK_STALE_MS = 30 * 60 * 1000;

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const acquireSendLock = async (lockPath: string = DEFAULT_LOCK_PATH): Promise<() => Promise<void>> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      await handle.close();

      return async () => {
        await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    // 既存ロックが古い、または持ち主のプロセスが存在しない場合だけ解除して再試行する
    let stale = false;
    try {
      const stat = await fs.stat(lockPath);
      const owner = JSON.parse(await fs.readFile(lockPath, "utf8")) as { pid?: number };
      stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS || typeof owner.pid !== "number" || !isProcessAlive(owner.pid);
    } catch {
      stale = true;
    }

    if (!stale) {
      break;
    }

    await fs.rm(lockPath, { force: true });
  }

  throw new Error("別のメール送信が実行中です（二重送信防止のため中止しました）。完了してから再実行してください。");
};
