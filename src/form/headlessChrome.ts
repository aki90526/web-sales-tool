import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// フォームのテスト用に、普段使いのChromeとは別プロファイルの画面なしChromeを起動する

type Evaluated = { result: { value?: any }; exceptionDetails?: { text: string; exception?: { description?: string } } };

export type HeadlessChromeClient = {
  Page: { enable(): Promise<void>; navigate(params: { url: string }): Promise<unknown>; loadEventFired(): Promise<unknown> };
  Emulation: { setDeviceMetricsOverride(params: Record<string, unknown>): Promise<unknown> };
  Runtime: { evaluate(params: Record<string, unknown>): Promise<Evaluated> };
  close(): Promise<void>;
};

type ChromeRemoteInterface = ((options: { port: number; target: unknown }) => Promise<HeadlessChromeClient>) & {
  Version(options: { port: number }): Promise<unknown>;
  New(options: { port: number; url: string }): Promise<{ id: string }>;
  Close(options: { port: number; id: string }): Promise<void>;
};

const CDP = require("chrome-remote-interface") as ChromeRemoteInterface;
const CHROME_PATH = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type HeadlessChrome = {
  // 新しいタブで url を開き、fn にクライアントを渡す。終わったらタブを閉じる
  withPage<T>(url: string, fn: (client: HeadlessChromeClient) => Promise<T>, options?: { timeoutMs?: number }): Promise<T>;
  close(): Promise<void>;
};

export const startHeadlessChrome = async (port = 9333): Promise<HeadlessChrome> => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "form-autofill-test-"));
  const chrome = spawn(
    CHROME_PATH,
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", "about:blank"],
    { stdio: "ignore" }
  );
  const exited = new Promise((resolve) => chrome.once("exit", resolve));

  const close = async (): Promise<void> => {
    chrome.kill();
    await exited;
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      await CDP.Version({ port });
      break;
    } catch {
      if (attempt >= 50) {
        await close();
        throw new Error("headless Chrome did not start");
      }
      await sleep(200);
    }
  }

  const withPage = async <T>(
    url: string,
    fn: (client: HeadlessChromeClient) => Promise<T>,
    options: { timeoutMs?: number } = {}
  ): Promise<T> => {
    const target = await CDP.New({ port, url: "about:blank" });
    const client = await CDP({ port, target });

    try {
      await client.Page.enable();
      await client.Emulation.setDeviceMetricsOverride({ width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      const loaded = client.Page.loadEventFired();
      await client.Page.navigate({ url });
      await Promise.race([loaded, sleep(options.timeoutMs ?? 20000)]);
      return await fn(client);
    } finally {
      await client.close();
      await CDP.Close({ port, id: target.id }).catch(() => undefined);
    }
  };

  return { withPage, close };
};
