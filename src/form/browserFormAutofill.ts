import { execFile } from "child_process";
import http from "http";
import path from "path";
import { FormCandidate } from "../contact/formCandidates";
import { FormFieldAliases, SenderInfo } from "../contact/salesMessage";

type ChromeRemoteInterface = {
  (options?: Record<string, unknown>): Promise<ChromeClient>;
  New: (options: Record<string, unknown>) => Promise<{ id: string }>;
  Activate: (options: Record<string, unknown>) => Promise<void>;
};

type ChromeClient = {
  Page: {
    enable: () => Promise<void>;
    loadEventFired: () => Promise<void>;
    navigate: (options: { url: string }) => Promise<void>;
  };
  Runtime: {
    enable: () => Promise<void>;
    evaluate: (options: {
      expression: string;
      awaitPromise?: boolean;
      returnByValue?: boolean;
    }) => Promise<{ result?: { value?: unknown } }>;
  };
  close: () => Promise<void>;
};

export type FormAutofillPayload = {
  sender: SenderInfo;
  formFieldAliases: FormFieldAliases;
  candidate: {
    leadId: string;
    companyName: string;
    subject: string;
    body: string;
  };
};

export type FormAutofillResult = {
  filled: Array<{ field: string; valueName: string; label: string }>;
  checked: Array<{ label: string }>;
  selected: Array<{ label: string; option: string }>;
  warnings: string[];
};

export type BrowserFillResult = {
  candidate: FormCandidate;
  result: FormAutofillResult;
};

type BrowserFillOptions = {
  chromePort: number;
  timeoutMs: number;
};

const chromeUserDataDir = path.resolve(process.cwd(), ".tmp", "chrome-form-fill-profile");

const requestJson = async <T>(url: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks: Buffer[] = [];

      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const statusCode = response.statusCode ?? 0;

        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Chrome remote debugging returned ${statusCode}: ${raw}`));
          return;
        }

        resolve(JSON.parse(raw) as T);
      });
    });

    request.on("error", reject);
    request.setTimeout(1000, () => request.destroy(new Error("Chrome remote debugging is not ready")));
  });
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const isChromeReady = async (port: number): Promise<boolean> => {
  try {
    await requestJson(`http://127.0.0.1:${port}/json/version`);
    return true;
  } catch {
    return false;
  }
};

const launchChrome = async (port: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "open",
      [
        "-na",
        "Google Chrome",
        "--args",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${chromeUserDataDir}`,
        "--no-first-run",
        "--no-default-browser-check"
      ],
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      }
    );
  });
};

const ensureChrome = async (port: number): Promise<void> => {
  if (!(await isChromeReady(port))) {
    await launchChrome(port);
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isChromeReady(port)) {
      return;
    }

    await sleep(500);
  }

  throw new Error("Google Chrome remote debugging did not start");
};

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for page load")), ms);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const notify = async (title: string, message: string): Promise<void> => {
  if (process.platform !== "darwin") {
    return;
  }

  await new Promise<void>((resolve) => {
    execFile(
      "osascript",
      [
        "-e",
        `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`
      ],
      () => resolve()
    );
  });
};

const pageAutofill = (payload: FormAutofillPayload): FormAutofillResult => {
  const result: FormAutofillResult = {
    filled: [],
    checked: [],
    selected: [],
    warnings: []
  };

  const values: Record<string, string> = {
    companyName: payload.sender.companyName,
    name: payload.sender.name,
    lastName: payload.sender.name.split(/\s+/)[0] || payload.sender.name,
    firstName: payload.sender.name.split(/\s+/).slice(1).join(" ") || payload.sender.name,
    email: payload.sender.email,
    tel: payload.sender.tel,
    url: payload.sender.url,
    subject: payload.candidate.subject,
    body: payload.candidate.body
  };

  const builtinAliases: Record<string, string[]> = {
    companyName: ["会社名", "貴社名", "法人名", "屋号", "組織名", "company", "organization"],
    name: ["お名前", "氏名", "担当者名", "ご担当者名", "name", "your-name"],
    lastName: ["姓", "last name", "family name", "sei"],
    firstName: ["名", "first name", "given name", "mei"],
    email: ["メールアドレス", "Email", "E-mail", "mail", "メール"],
    tel: ["電話番号", "TEL", "Tel", "tel", "phone", "mobile"],
    url: ["URL", "ホームページ", "Webサイト", "サイトURL", "website", "site"],
    subject: ["件名", "タイトル", "題名", "subject", "title"],
    body: ["お問い合わせ内容", "内容", "本文", "メッセージ", "詳細", "message", "body", "textarea"]
  };

  const aliases: Record<string, string[]> = {
    ...builtinAliases,
    companyName: [...builtinAliases.companyName, ...payload.formFieldAliases.companyName],
    name: [...builtinAliases.name, ...payload.formFieldAliases.name],
    email: [...builtinAliases.email, ...payload.formFieldAliases.email],
    tel: [...builtinAliases.tel, ...payload.formFieldAliases.tel],
    url: [...builtinAliases.url, ...payload.formFieldAliases.url],
    subject: [...builtinAliases.subject, ...payload.formFieldAliases.subject],
    body: [...builtinAliases.body, ...payload.formFieldAliases.body]
  };

  const normalize = (value: string): string => {
    return value
      .replace(/\s+/g, " ")
      .replace(/[：:＊*必須]/g, " ")
      .trim()
      .toLowerCase();
  };

  const visible = (element: HTMLElement): boolean => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const labelFor = (element: HTMLElement): string => {
    const parts: string[] = [];
    const id = element.getAttribute("id");
    const name = element.getAttribute("name");

    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label?.textContent) {
        parts.push(label.textContent);
      }
    }

    const closestLabel = element.closest("label");
    if (closestLabel?.textContent) {
      parts.push(closestLabel.textContent);
    }

    const parent = element.parentElement;
    if (parent?.textContent) {
      parts.push(parent.textContent.slice(0, 160));
    }

    const previous = element.previousElementSibling;
    if (previous?.textContent) {
      parts.push(previous.textContent.slice(0, 120));
    }

    [
      "aria-label",
      "placeholder",
      "name",
      "id",
      "autocomplete",
      "type"
    ].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) {
        parts.push(value);
      }
    });

    if (name) {
      parts.push(name);
    }

    return normalize(Array.from(new Set(parts)).join(" "));
  };

  const matches = (text: string, key: string): boolean => {
    return aliases[key].some((alias) => text.includes(normalize(alias)));
  };

  const inferKey = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
    const text = labelFor(element);
    const tagName = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();

    if (type === "email" || autocomplete === "email" || matches(text, "email")) {
      return "email";
    }

    if (type === "tel" || autocomplete === "tel" || matches(text, "tel")) {
      return "tel";
    }

    if (tagName === "textarea" || matches(text, "body")) {
      return "body";
    }

    if (/family-name/.test(autocomplete) || matches(text, "lastName")) {
      return "lastName";
    }

    if (/given-name/.test(autocomplete) || matches(text, "firstName")) {
      return "firstName";
    }

    if (matches(text, "subject")) {
      return "subject";
    }

    if (matches(text, "companyName")) {
      return "companyName";
    }

    if (matches(text, "url")) {
      return "url";
    }

    if (matches(text, "name")) {
      return "name";
    }

    return "";
  };

  const setValue = (
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
    valueName: string
  ): void => {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    result.filled.push({
      field: element.getAttribute("name") || element.getAttribute("id") || element.tagName.toLowerCase(),
      valueName,
      label: labelFor(element).slice(0, 120)
    });
  };

  const fillSelect = (element: HTMLSelectElement): void => {
    if (!visible(element) || element.disabled || element.value) {
      return;
    }

    const preferred = Array.from(element.options).find((option) => {
      const text = normalize(option.textContent || option.value);
      return Boolean(option.value) && /(お問い合わせ|お問合せ|その他|協業|パートナー|業務委託|web|制作|相談)/i.test(text);
    });

    if (!preferred) {
      return;
    }

    element.value = preferred.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    result.selected.push({
      label: labelFor(element).slice(0, 120),
      option: preferred.textContent?.trim() || preferred.value
    });
  };

  const fillTextControl = (element: HTMLInputElement | HTMLTextAreaElement): void => {
    if (!visible(element) || element.disabled || element.readOnly || element.value.trim()) {
      return;
    }

    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "password", "file", "submit", "button", "reset", "image"].includes(type)) {
      return;
    }

    const key = inferKey(element);
    if (!key || !values[key]) {
      return;
    }

    setValue(element, values[key], key);
  };

  const checkConsent = (element: HTMLInputElement): void => {
    if (!visible(element) || element.disabled || element.type !== "checkbox" || element.checked) {
      return;
    }

    const text = labelFor(element);
    if (!/(同意|確認|プライバシー|個人情報|規約|privacy|policy)/i.test(text)) {
      return;
    }

    element.click();
    result.checked.push({ label: text.slice(0, 120) });
  };

  document
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
    .forEach((element) => fillTextControl(element));

  document
    .querySelectorAll<HTMLSelectElement>("select")
    .forEach((element) => fillSelect(element));

  document
    .querySelectorAll<HTMLInputElement>("input[type='checkbox']")
    .forEach((element) => checkConsent(element));

  if (result.filled.length === 0) {
    result.warnings.push("入力できる項目を自動判定できませんでした。フォーム項目名を確認してください。");
  }

  return result;
};

const runInPage = async (
  client: ChromeClient,
  payload: FormAutofillPayload
): Promise<FormAutofillResult> => {
  const expression = `(${pageAutofill.toString()})(${JSON.stringify(payload)})`;
  const response = await client.Runtime.evaluate({
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  return response.result?.value as FormAutofillResult;
};

export const fillCandidateFormsInBrowser = async (
  candidates: FormCandidate[],
  sender: SenderInfo,
  formFieldAliases: FormFieldAliases,
  options: BrowserFillOptions
): Promise<BrowserFillResult[]> => {
  const CDP = require("chrome-remote-interface") as ChromeRemoteInterface;
  const results: BrowserFillResult[] = [];

  await ensureChrome(options.chromePort);

  for (const candidate of candidates) {
    const target = await CDP.New({ port: options.chromePort, url: "about:blank" });
    await CDP.Activate({ port: options.chromePort, id: target.id });
    const client = await CDP({ port: options.chromePort, target });

    try {
      await client.Page.enable();
      await client.Runtime.enable();
      const loaded = client.Page.loadEventFired();
      await client.Page.navigate({ url: candidate.formUrl });

      try {
        await withTimeout(loaded, options.timeoutMs);
      } catch {
        // Many contact pages keep background requests open. Filling can still work after a short wait.
        await sleep(2000);
      }

      const result = await runInPage(client, {
        sender,
        formFieldAliases,
        candidate: {
          leadId: candidate.leadId,
          companyName: candidate.companyName,
          subject: candidate.subject,
          body: candidate.body
        }
      });

      results.push({ candidate, result });
      await notify(
        "フォーム入力を確認してください",
        `${candidate.leadId} ${candidate.companyName}: 入力内容を確認し、問題なければ送信ボタンを押してください。`
      );
    } finally {
      await client.close();
    }
  }

  return results;
};
