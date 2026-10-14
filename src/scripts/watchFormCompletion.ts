import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import {
  ChromeClient,
  CompletionSnapshot,
  describeCf7SubmitError,
  isFormCompleted,
  isProbableSubmitRedirectToTop,
  readCompletionSnapshot
} from "../form/browserFormAutofill";
import { appendCaptchaNote } from "../form/formCaptchaNote";
import { touchFormWatchHeartbeat, upsertFormWatchEntry } from "../form/formWatchStatus";
import { loadConfig } from "../config/env";
import { createSheetsClient } from "../google/sheetsClient";

type WatchEntry = {
  leadId: string;
  companyName: string;
  targetId: string;
  baseline: CompletionSnapshot | null;
};

type WatchFile = {
  port: number;
  entries: WatchEntry[];
};

type ChromeRemoteInterface = {
  (options?: Record<string, unknown>): Promise<ChromeClient>;
  List: (options: Record<string, unknown>) => Promise<Array<{ id: string; type: string; url: string; parentId?: string }>>;
};

type CheckResult = {
  state: "done" | "needs-confirm" | "waiting" | "gone";
  submitError?: string;
  // 外部フォームのiframeが返した送信エラー（reCAPTCHA等で弾かれた可能性が高いもの）
  spamLike?: boolean;
};

// iframeに埋め込まれた外部フォーム（BowNowなど）の最初の状態。完了画面や失敗表示の判定の基準にする
const iframeBaselines = new Map<string, CompletionSnapshot>();

const IFRAME_IGNORED = /(recaptcha|googletagmanager|doubleclick|youtube|facebook|twitter|instagram|google\.com\/maps)/i;
const IFRAME_FAILURE = /(送信に失敗|送信できませんでした|エラーが発生|失敗しました)/;
const IFRAME_SPAM_LIKE = /(時間を空け|別のブラウザ|ロボット|スパム|reCAPTCHA|不正)/i;

const checkIframes = async (CDP: ChromeRemoteInterface, port: number, parentTargetId: string): Promise<CheckResult | null> => {
  let targets: Array<{ id: string; type: string; url: string; parentId?: string }> = [];

  try {
    targets = (await CDP.List({ port })).filter(
      (target) => target.type === "iframe" && target.parentId === parentTargetId && !IFRAME_IGNORED.test(target.url)
    );
  } catch {
    return null;
  }

  for (const target of targets) {
    let iframeClient: ChromeClient | null = null;

    try {
      iframeClient = await CDP({ port, target: target.id });
      await iframeClient.Runtime.enable();
      const snapshot = await readCompletionSnapshot(iframeClient);
      const textResponse = await iframeClient.Runtime.evaluate({
        expression: "(document.body && document.body.innerText || '').slice(0, 4000)",
        returnByValue: true
      });
      const text = typeof textResponse.result?.value === "string" ? textResponse.result.value : "";

      if (!snapshot) {
        continue;
      }

      const baseline = iframeBaselines.get(target.id);

      if (!baseline) {
        iframeBaselines.set(target.id, snapshot);
        continue;
      }

      const failureMatch = text.match(IFRAME_FAILURE);

      if (failureMatch) {
        const line = text.split("\n").find((entry) => IFRAME_FAILURE.test(entry))?.trim().slice(0, 100) ?? failureMatch[0];

        return {
          state: "waiting",
          submitError: `外部フォームが送信エラーを返しました: ${line}`,
          spamLike: IFRAME_SPAM_LIKE.test(line) || /bownow|formrun|hubspot/i.test(target.url)
        };
      }

      const completed =
        (snapshot.strictDone && !baseline.strictDone) ||
        (snapshot.looseDone && !baseline.looseDone && !snapshot.looksLikeConfirmPage && !snapshot.hasSubmitButton);

      if (completed) {
        return { state: "done" };
      }
    } catch {
      // The iframe may have navigated or closed.
    } finally {
      await iframeClient?.close().catch(() => undefined);
    }
  }

  return null;
};

const POLL_INTERVAL_MS = 3000;
const MAX_WATCH_MS = 90 * 60 * 1000;
const logPath = path.resolve(process.cwd(), ".tmp", "form-watch.log");

const log = (message: string): void => {
  const line = `${new Date().toISOString()} ${message}`;

  console.log(line);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const notify = (title: string, message: string): void => {
  if (process.platform !== "darwin") {
    return;
  }

  execFile("osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], () => undefined);
};

const markSent = (leadId: string): Promise<{ ok: boolean; output: string }> => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolve) => {
    execFile(
      npm,
      ["run", "forms:mark-sent", "--", "--lead-id", leadId, "--note", "フォーム送信完了画面を自動検知して記録"],
      { cwd: process.cwd() },
      (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}${stderr}`.trim() })
    );
  });
};

const checkEntry = async (
  CDP: ChromeRemoteInterface,
  port: number,
  entry: WatchEntry
): Promise<CheckResult> => {
  let client: ChromeClient;

  try {
    client = await CDP({ port, target: entry.targetId });
  } catch {
    return { state: "gone" };
  }

  try {
    await client.Runtime.enable();
    const snapshot = await readCompletionSnapshot(client);

    if (!snapshot) {
      return { state: "waiting" };
    }

    if (isFormCompleted(entry.baseline, snapshot)) {
      return { state: "done" };
    }

    if (isProbableSubmitRedirectToTop(entry.baseline, snapshot)) {
      return { state: "needs-confirm" };
    }

    const cf7Error = describeCf7SubmitError(snapshot);

    if (cf7Error) {
      return { state: "waiting", submitError: cf7Error };
    }

    return (await checkIframes(CDP, port, entry.targetId)) ?? { state: "waiting" };
  } catch {
    return { state: "waiting" };
  } finally {
    await client.close().catch(() => undefined);
  }
};

const main = async (): Promise<void> => {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error("Usage: ts-node src/scripts/watchFormCompletion.ts <watch-file.json>");
  }

  const watch = JSON.parse(fs.readFileSync(filePath, "utf8")) as WatchFile;
  const CDP = require("chrome-remote-interface") as ChromeRemoteInterface;
  const pending = new Map(watch.entries.map((entry) => [entry.leadId, entry]));
  const startedAt = Date.now();

  log(`Watching ${pending.size} form tab(s): ${Array.from(pending.keys()).join(", ")}`);
  pending.forEach((entry) => upsertFormWatchEntry(entry.leadId, entry.companyName, { state: "watching" }));
  let lastHeartbeatAt = Date.now();
  const lastSubmitErrors = new Map<string, string>();

  while (pending.size > 0 && Date.now() - startedAt < MAX_WATCH_MS) {
    for (const entry of Array.from(pending.values())) {
      const { state, submitError, spamLike } = await checkEntry(CDP, watch.port, entry);

      if (state === "waiting" && submitError && (/（spam）/.test(submitError) || spamLike)) {
        log(`${entry.leadId} ${entry.companyName}: spam detected. Manual submission required.`);
        try {
          const sheets = await createSheetsClient(loadConfig());
          await appendCaptchaNote(sheets, entry.leadId, "スパム判定（reCAPTCHA等）。自動送信不可のため手動で送信");
        } catch (error: unknown) {
          log(`${entry.leadId}: failed to write captcha note: ${error instanceof Error ? error.message : String(error)}`);
        }
        upsertFormWatchEntry(entry.leadId, entry.companyName, {
          state: "manual-required",
          message: `スパムと判定され、自動では送信できません。「自分で入力」で、普段のブラウザから手動で送信してください（${submitError.slice(0, 80)}）`
        });
        notify("スパム判定のため手動送信が必要です", `${entry.leadId} ${entry.companyName}`);
        pending.delete(entry.leadId);
        continue;
      }

      if (state === "waiting" && submitError && lastSubmitErrors.get(entry.leadId) !== submitError) {
        lastSubmitErrors.set(entry.leadId, submitError);
        log(`${entry.leadId} ${entry.companyName}: form reported an error: ${submitError}`);
        upsertFormWatchEntry(entry.leadId, entry.companyName, {
          state: "submit-error",
          message: `フォームが送信エラーを返しました: ${submitError}`
        });
        notify("フォームの送信エラー", `${entry.leadId} ${entry.companyName}: ${submitError.slice(0, 60)}`);
      }

      if (state === "gone") {
        log(`${entry.leadId} ${entry.companyName}: tab closed. Stopped watching.`);
        upsertFormWatchEntry(entry.leadId, entry.companyName, {
          state: "closed",
          message: "タブが閉じられたため、見張りを終了しました（送信した場合は手動で「送信済みにする」を押してください）"
        });
        pending.delete(entry.leadId);
      } else if (state === "needs-confirm") {
        log(`${entry.leadId} ${entry.companyName}: redirected to top after submit. Needs manual confirmation.`);
        upsertFormWatchEntry(entry.leadId, entry.companyName, {
          state: "needs-confirm",
          message: "送信後にトップページへ転送されました。送信できた可能性があります（完了画面が無いサイトです）。送信できていれば「送信済みにする」を押してください"
        });
        notify("送信後にトップへ転送されました（要確認）", `${entry.leadId} ${entry.companyName}`);
        pending.delete(entry.leadId);
      } else if (state === "done") {
        log(`${entry.leadId} ${entry.companyName}: completion page detected. Marking as sent...`);
        const result = await markSent(entry.leadId);

        log(`${entry.leadId}: ${result.ok ? "marked as sent" : "mark-sent failed"} ${result.output.split("\n").pop() ?? ""}`);
        const alreadySent = !result.ok && /status is 送信済み/.test(result.output);

        upsertFormWatchEntry(entry.leadId, entry.companyName, {
          state: result.ok ? "recorded" : alreadySent ? "already-recorded" : "failed",
          message: result.ok
            ? "送信完了画面を検知して「送信済み」に更新しました"
            : alreadySent
            ? "すでに「送信済み」になっていました（手動で記録済み）"
            : `自動記録に失敗しました: ${result.output.split("\n").pop() ?? ""}`
        });
        notify(
          result.ok ? "フォーム送信済みに更新しました" : alreadySent ? "フォームはすでに送信済みです" : "フォーム送信の自動記録に失敗しました",
          `${entry.leadId} ${entry.companyName}`
        );
        pending.delete(entry.leadId);
      }
    }

    if (pending.size > 0 && Date.now() - lastHeartbeatAt > 30000) {
      touchFormWatchHeartbeat(Array.from(pending.keys()));
      lastHeartbeatAt = Date.now();
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (pending.size > 0) {
    log(`Watch timed out. Not recorded: ${Array.from(pending.keys()).join(", ")}`);
    pending.forEach((entry) =>
      upsertFormWatchEntry(entry.leadId, entry.companyName, {
        state: "timeout",
        message: "90分間、送信完了画面を検知できませんでした（送信した場合は手動で「送信済みにする」を押してください）"
      })
    );
  }

  fs.rmSync(filePath, { force: true });
};

main().catch((error: unknown) => {
  log(`watchFormCompletion failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
