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
  Input: {
    dispatchKeyEvent: (options: Record<string, unknown>) => Promise<void>;
    dispatchMouseEvent: (options: Record<string, unknown>) => Promise<void>;
  };
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
      contextId?: number;
    }) => Promise<{ result?: { value?: unknown } }>;
    executionContextCreated?: (callback: (event: { context?: { id?: number } }) => void) => void;
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

type SelectKeyboardTarget = {
  label: string;
  option: string;
  optionIndex: number;
  selectedIndex: number;
  selectIndex: number;
  x: number;
  y: number;
};

type SelectStatus = {
  label: string;
  option: string;
  value: string;
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

const mergeAutofillResults = (results: FormAutofillResult[]): FormAutofillResult => {
  const uniqueBy = <T>(values: T[], keyFor: (value: T) => string): T[] => {
    const seen = new Set<string>();
    const unique: T[] = [];

    values.forEach((value) => {
      const key = keyFor(value);

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(value);
      }
    });

    return unique;
  };

  const filled = uniqueBy(
      results.flatMap((result) => result.filled),
      (value) => `${value.field}:${value.valueName}`
    );
  const checked = uniqueBy(
      results.flatMap((result) => result.checked),
      (value) => value.label
    );
  const selected = uniqueBy(
      results.flatMap((result) => result.selected),
      (value) => `${value.label}:${value.option}`
    );
  const warnings = uniqueBy(
      results.flatMap((result) => result.warnings),
      (value) => value
    ).filter((warning) => {
      if (filled.length > 0 && warning.includes("入力できる項目を自動判定できませんでした")) {
        return false;
      }

      if (!warning.includes("手動選択")) {
        return true;
      }

      return !selected.some((value) => value.label && warning.includes(value.label));
    });

  return {
    filled,
    checked,
    selected,
    warnings
  };
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
    nameKana: payload.sender.nameKana,
    nameHiragana: payload.sender.nameHiragana,
    department: payload.sender.department,
    nameWithCompanyName: `${payload.sender.name}（${payload.sender.companyName}）`,
    lastName: payload.sender.name.split(/\s+/)[0] || payload.sender.name,
    firstName: payload.sender.name.split(/\s+/).slice(1).join(" ") || payload.sender.name,
    email: payload.sender.email,
    tel: payload.sender.tel,
    url: payload.sender.url,
    address: payload.sender.formAddress,
    postalCode: payload.sender.postalCode,
    prefecture: payload.sender.prefecture,
    city: payload.sender.city,
    streetAddress: payload.sender.streetAddress,
    subject: payload.candidate.subject,
    japanCapital: "東京",
    body: payload.candidate.body
  };

  const builtinAliases: Record<string, string[]> = {
    companyName: ["会社名", "貴社名", "法人名", "貴院名", "屋号", "組織名", "company", "organization", "org"],
    name: ["お名前", "氏名", "担当者名", "ご担当者名", "name", "your-name"],
    nameKana: ["フリガナ", "ふりがな", "カナ", "氏名カナ", "氏名かな", "お名前カナ", "ご担当者名フリガナ", "kana", "furigana"],
    nameHiragana: ["ふりがな", "氏名かな", "お名前かな", "ご担当者名ふりがな"],
    department: ["部署", "部署名", "所属部署", "所属部署名", "部門", "部門名", "department", "division", "section"],
    lastName: ["last name", "family name", "sei"],
    firstName: ["first name", "given name", "mei"],
    email: ["メールアドレス", "Email", "E-mail", "mail", "メール"],
    tel: ["電話番号", "TEL", "Tel", "tel", "phone", "mobile"],
    url: ["URL", "ホームページ", "Webサイト", "サイトURL", "website", "site"],
    address: ["住所", "所在地", "ご住所", "住所地", "address", "location"],
    postalCode: ["郵便番号", "郵便", "〒", "zip", "postal"],
    prefecture: ["都道府県", "都道府県名", "prefecture"],
    city: ["市区町村", "市町村", "区市町村", "市区郡町村", "city", "municipality"],
    streetAddress: ["以降の住所", "以降住所", "番地", "町名番地", "丁目番地", "street", "address2"],
    subject: ["件名", "タイトル", "題名", "subject", "title"],
    japanCapital: ["日本の首都", "首都は", "スパム対策"],
    body: ["お問い合わせ内容", "内容", "本文", "メッセージ", "詳細", "message", "body", "textarea"]
  };

  const aliases: Record<string, string[]> = {
    ...builtinAliases,
    companyName: [...builtinAliases.companyName, ...payload.formFieldAliases.companyName],
    name: [...builtinAliases.name, ...payload.formFieldAliases.name],
    nameKana: [...builtinAliases.nameKana, ...payload.formFieldAliases.nameKana],
    nameHiragana: [...builtinAliases.nameHiragana, ...payload.formFieldAliases.nameHiragana],
    department: [...builtinAliases.department, ...payload.formFieldAliases.department],
    email: [...builtinAliases.email, ...payload.formFieldAliases.email],
    tel: [...builtinAliases.tel, ...payload.formFieldAliases.tel],
    url: [...builtinAliases.url, ...payload.formFieldAliases.url],
    address: [...builtinAliases.address, ...payload.formFieldAliases.address],
    postalCode: [...builtinAliases.postalCode, ...payload.formFieldAliases.postalCode],
    prefecture: [...builtinAliases.prefecture, ...payload.formFieldAliases.prefecture],
    city: [...builtinAliases.city, ...payload.formFieldAliases.city],
    streetAddress: [...builtinAliases.streetAddress, ...payload.formFieldAliases.streetAddress],
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

    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
      const controls = parent.querySelectorAll("input, textarea, select").length;
      const text = parent.textContent?.trim() ?? "";

      if (controls <= 2 && text.length <= 160) {
        parts.push(text);
      }
    }

    let context = element.parentElement;
    for (let depth = 0; context && depth < 4; depth += 1, context = context.parentElement) {
      const dataName = context.getAttribute("data-name");
      if (dataName) {
        parts.push(dataName);
      }

      const previousContext = context.previousElementSibling;
      const previousText = previousContext?.textContent?.trim() ?? "";
      const previousControlCount = previousContext?.querySelectorAll("input, textarea, select").length ?? 0;
      if (previousText && previousText.length <= 160 && previousControlCount === 0) {
        parts.push(previousText);
      }
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

  const surroundingTextFor = (element: HTMLElement): string => {
    const parts = [labelFor(element)];
    const container = element.closest<HTMLElement>("dd, tr, li, p, div, label");

    if (container?.textContent) {
      parts.push(container.textContent);
    }

    const previous = container?.previousElementSibling;
    if (previous?.textContent) {
      parts.push(previous.textContent);
    }

    const parentPrevious = container?.parentElement?.previousElementSibling;
    if (parentPrevious?.textContent) {
      parts.push(parentPrevious.textContent);
    }

    return normalize(Array.from(new Set(parts)).join(" "));
  };

  const matches = (text: string, key: string): boolean => {
    return aliases[key].some((alias) => text.includes(normalize(alias)));
  };

  const shortLabelFor = (element: HTMLElement): string => {
    const text = labelFor(element);

    if (text.includes("お問い合わせ種別")) {
      return "お問い合わせ種別";
    }

    if (text.includes("プライバシー")) {
      return "プライバシーポリシー同意";
    }

    if (text.includes("個人情報")) {
      return "個人情報同意";
    }

    return text.slice(0, 80) || element.getAttribute("name") || element.getAttribute("id") || element.tagName.toLowerCase();
  };

  const hasStandaloneJapaneseField = (text: string, value: string): boolean => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[\\s\\[\\]（）()【】「」:：_\\-/／])${escaped}($|[\\s\\[\\]（）()【】「」:：_\\-/／])`);

    return pattern.test(text);
  };

  const matchesLastName = (text: string, autocomplete: string): boolean => {
    return /family-name/.test(autocomplete) || matches(text, "lastName") || hasStandaloneJapaneseField(text, "姓");
  };

  const matchesFirstName = (text: string, autocomplete: string): boolean => {
    if (text.includes("会社名") || text.includes("法人名") || text.includes("お名前") || text.includes("氏名")) {
      return /given-name/.test(autocomplete) || matches(text, "firstName");
    }

    return /given-name/.test(autocomplete) || matches(text, "firstName") || hasStandaloneJapaneseField(text, "名");
  };

  const matchesFullNameOnly = (text: string): boolean => {
    if (!/(お名前|氏名|担当者名|ご担当者名)/.test(text)) {
      return false;
    }

    return !hasStandaloneJapaneseField(text, "姓") && !hasStandaloneJapaneseField(text, "名");
  };

  const inferKey = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
    const text = labelFor(element);
    const tagName = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();

    if (type === "email" || autocomplete === "email") {
      return "email";
    }

    if (matches(text, "postalCode")) {
      return "postalCode";
    }

    if (type === "tel" || autocomplete === "tel" || matches(text, "tel")) {
      return "tel";
    }

    if (matches(text, "email")) {
      return "email";
    }

    if (tagName === "textarea" || matches(text, "body")) {
      return "body";
    }

    if (matches(text, "japanCapital")) {
      return "japanCapital";
    }

    if (matches(text, "nameHiragana")) {
      return "nameHiragana";
    }

    if (matches(text, "nameKana")) {
      return "nameKana";
    }

    if (matches(text, "department")) {
      return "department";
    }

    if (matches(text, "prefecture")) {
      return "prefecture";
    }

    if (matches(text, "city")) {
      return "city";
    }

    if (matches(text, "streetAddress")) {
      return "streetAddress";
    }

    if (matches(text, "address")) {
      return "address";
    }

    if (matches(text, "companyName")) {
      if (text.includes("屋号") && matches(text, "name")) {
        return "nameWithCompanyName";
      }

      return "companyName";
    }

    if (matchesFullNameOnly(text) && matches(text, "name")) {
      return "name";
    }

    if (matchesLastName(text, autocomplete)) {
      return "lastName";
    }

    if (matchesFirstName(text, autocomplete)) {
      return "firstName";
    }

    if (matches(text, "name")) {
      return "name";
    }

    if (matches(text, "subject")) {
      return "subject";
    }

    if (matches(text, "url")) {
      return "url";
    }

    return "";
  };

  const digitsOnly = (value: string): string => {
    return value.replace(/\D/g, "");
  };

  const splitJapaneseTel = (value: string): string[] => {
    const digits = digitsOnly(value);

    if (digits.length === 11) {
      return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7)];
    }

    if (digits.length === 10) {
      return [digits.slice(0, 2), digits.slice(2, 6), digits.slice(6)];
    }

    return [digits];
  };

  const splitJapanesePostalCode = (value: string): string[] => {
    const digits = digitsOnly(value);

    if (digits.length === 7) {
      return [digits.slice(0, 3), digits.slice(3)];
    }

    return [value];
  };

  const telLike = (element: HTMLInputElement): boolean => {
    const type = (element.getAttribute("type") || "").toLowerCase();
    const text = labelFor(element);
    if (matches(text, "postalCode")) {
      return false;
    }

    return type === "tel" || matches(text, "tel");
  };

  const postalCodeLike = (element: HTMLInputElement): boolean => {
    const text = labelFor(element);
    return matches(text, "postalCode");
  };

  const splitPostalPartLike = (element: HTMLInputElement): boolean => {
    const label = [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("autocomplete"),
      element.className
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const maxLength = Number(element.getAttribute("maxlength") || 0);
    const size = Number(element.getAttribute("size") || 0);

    return (
      /(zip|postal|postcode|post-code|郵便|yubin|addr_zip|zip_code).*(1|2|01|02|a|b)|(^|[_-])(1|2|01|02|a|b)($|[_-])/i.test(label) ||
      (maxLength > 0 && maxLength <= 4) ||
      (size > 0 && size <= 4)
    );
  };

  const telValueForElement = (element: HTMLInputElement): string => {
    const parts = splitJapaneseTel(payload.sender.tel);

    if (parts.length < 2) {
      return payload.sender.tel;
    }

    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
      const controls = Array.from(parent.querySelectorAll<HTMLInputElement>("input"))
        .filter((input) => input !== element || telLike(input))
        .filter((input) => !input.disabled && !input.readOnly && visible(input) && telLike(input));

      if (controls.length >= 2 && controls.length <= 4) {
        const index = controls.indexOf(element);

        if (index >= 0 && index < parts.length) {
          return parts[index];
        }
      }
    }

    return payload.sender.tel;
  };

  const postalCodeValueForElement = (element: HTMLInputElement): string => {
    const parts = splitJapanesePostalCode(payload.sender.postalCode);

    if (parts.length < 2) {
      return payload.sender.postalCode;
    }

    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
      const controls = Array.from(parent.querySelectorAll<HTMLInputElement>("input"))
        .filter((input) => input !== element || postalCodeLike(input))
        .filter((input) => !input.disabled && !input.readOnly && visible(input) && postalCodeLike(input));

      if (controls.length === 2 && controls.every((input) => splitPostalPartLike(input))) {
        const index = controls.indexOf(element);

        if (index >= 0 && index < parts.length) {
          return parts[index];
        }
      }
    }

    return payload.sender.postalCode;
  };

  const setNativeValue = (
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ): void => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  };

  const setValue = (
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
    valueName: string
  ): void => {
    element.focus();
    if (element instanceof HTMLTextAreaElement) {
      element.value = "";
    }
    setNativeValue(element, value);
    if (element instanceof HTMLTextAreaElement && element.value !== value) {
      element.select();
      document.execCommand("insertText", false, value);
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();

    const filled = {
      field: element.getAttribute("name") || element.getAttribute("id") || element.tagName.toLowerCase(),
      valueName,
      label: labelFor(element).slice(0, 120)
    };

    result.filled.push(filled);

    if (element.value !== value) {
      result.warnings.push(`${filled.label || filled.field} に ${valueName} を反映できませんでした。手動で確認してください。`);
    }
  };

  const scoreChoiceText = (text: string): number => {
    if (/(協業|パートナー|提携|業務委託|外注)/i.test(text)) {
      return 60;
    }

    if (/(プロジェクト|案件|仕事|ご相談|相談)/i.test(text)) {
      return 50;
    }

    if (/(web|ウェブ|制作|相談)/i.test(text)) {
      return 40;
    }

    if (/(その他|other)/i.test(text)) {
      return 30;
    }

    if (/(お問い合わせ|お問合せ|問い合わせ)/i.test(text)) {
      return 10;
    }

    return 1;
  };

  const scoreOption = (option: HTMLOptionElement): number => {
    if (!option.value) {
      return 0;
    }

    return scoreChoiceText(normalize(option.textContent || option.value));
  };

  const isInquiryChoiceLabel = (text: string): boolean => {
    return /(お問い合わせ|お問合せ|問い合わせ|項目|種別|カテゴリ|カテゴリー|用件|ご用件|contact|inquiry|type|category)/i.test(text);
  };

  const fillPrefectureSelect = (element: HTMLSelectElement): boolean => {
    if (element.disabled || !matches(labelFor(element), "prefecture")) {
      return false;
    }

    if (element.value) {
      const selectedOption = element.options[element.selectedIndex];
      result.selected.push({
        label: shortLabelFor(element),
        option: selectedOption?.textContent?.trim() || element.value
      });
      return true;
    }

    const prefecture = normalize(payload.sender.prefecture);
    const preferred = Array.from(element.options).find((option) => {
      if (!option.value) {
        return false;
      }

      const text = normalize(option.textContent || "");
      const value = normalize(option.value);
      return text === prefecture || value === prefecture || text.includes(prefecture);
    });

    if (!preferred) {
      result.warnings.push(`${shortLabelFor(element)} は手動選択が必要です。`);
      return true;
    }

    element.value = preferred.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    if (element.value === preferred.value) {
      result.selected.push({
        label: shortLabelFor(element),
        option: preferred.textContent?.trim() || preferred.value
      });
    } else {
      result.warnings.push(`${shortLabelFor(element)} は手動選択が必要です。`);
    }

    return true;
  };

  const fillSelect = (element: HTMLSelectElement): void => {
    if (fillPrefectureSelect(element)) {
      return;
    }

    if (element.disabled || !isInquiryChoiceLabel(labelFor(element))) {
      return;
    }

    if (element.value) {
      const selectedOption = element.options[element.selectedIndex];
      result.selected.push({
        label: shortLabelFor(element),
        option: selectedOption?.textContent?.trim() || element.value
      });
      return;
    }

    const preferred = Array.from(element.options)
      .map((option) => ({ option, score: scoreOption(option) }))
      .sort((a, b) => b.score - a.score)[0];

    if (!preferred || preferred.score <= 0) {
      return;
    }

    element.value = preferred.option.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    if (element.value === preferred.option.value) {
      result.selected.push({
        label: shortLabelFor(element),
        option: preferred.option.textContent?.trim() || preferred.option.value
      });
    } else {
      result.warnings.push(`${shortLabelFor(element)} は手動選択が必要です。`);
    }
  };

  const labelElementFor = (element: HTMLInputElement): HTMLElement | null => {
    const id = element.getAttribute("id");

    if (id) {
      const explicitLabel = document.querySelector<HTMLElement>(`label[for="${CSS.escape(id)}"]`);
      if (explicitLabel) {
        return explicitLabel;
      }
    }

    return element.closest<HTMLElement>("label");
  };

  const radioOptionLabelFor = (element: HTMLInputElement): string => {
    const parts: string[] = [];
    const label = labelElementFor(element);
    const next = element.nextElementSibling;
    const parent = element.parentElement;

    if (label?.textContent) {
      parts.push(label.textContent);
    }

    if (next?.textContent) {
      parts.push(next.textContent);
    }

    if (parent && parent.querySelectorAll("input[type='radio']").length <= 1 && parent.textContent) {
      parts.push(parent.textContent);
    }

    ["aria-label", "value", "name", "id"].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) {
        parts.push(value);
      }
    });

    return Array.from(new Set(parts.map((part) => part.trim()).filter(Boolean))).join(" ").slice(0, 120);
  };

  const radioGroupLabelFor = (elements: HTMLInputElement[]): string => {
    const first = elements[0];

    if (first.name) {
      return normalize(first.name);
    }

    const fieldset = first.closest("fieldset");
    const legend = fieldset?.querySelector("legend");

    if (legend?.textContent) {
      return normalize(legend.textContent);
    }

    let parent = first.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const radioCount = parent.querySelectorAll("input[type='radio']").length;
      const text = parent.textContent?.trim() ?? "";

      if (radioCount === elements.length && text.length <= 240) {
        return normalize(text);
      }
    }

    return normalize(first.getAttribute("name") || first.getAttribute("id") || "radio");
  };

  const radioVisible = (element: HTMLInputElement): boolean => {
    const label = labelElementFor(element);
    return visible(element) || Boolean(label && visible(label));
  };

  const isInquiryRadioGroup = (elements: HTMLInputElement[]): boolean => {
    return isInquiryChoiceLabel(radioGroupLabelFor(elements));
  };

  const checkRadio = (element: HTMLInputElement): void => {
    const label = labelElementFor(element);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");

    element.focus();
    (label || element).click();

    if (!element.checked) {
      if (descriptor?.set) {
        descriptor.set.call(element, true);
      } else {
        element.checked = true;
      }
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const fillRadioGroups = (): void => {
    const groups = new Map<string, HTMLInputElement[]>();

    document
      .querySelectorAll<HTMLInputElement>("input[type='radio']")
      .forEach((element) => {
        if (element.disabled || !radioVisible(element)) {
          return;
        }

        const formKey = element.form?.id || element.form?.getAttribute("name") || "form";
        const fieldsetKey = element.closest("fieldset")?.textContent?.slice(0, 80) || "fieldset";
        const key = element.name
          ? `${formKey}:name:${element.name}`
          : `${formKey}:fieldset:${fieldsetKey}`;
        const current = groups.get(key) ?? [];
        current.push(element);
        groups.set(key, current);
      });

    groups.forEach((elements) => {
      if (!isInquiryRadioGroup(elements)) {
        return;
      }

      if (elements.some((element) => element.checked)) {
        const checked = elements.find((element) => element.checked);
        if (checked) {
          result.selected.push({
            label: radioGroupLabelFor(elements),
            option: radioOptionLabelFor(checked)
          });
        }
        return;
      }

      const choices = elements
        .map((element) => ({
          element,
          optionLabel: radioOptionLabelFor(element),
          score: scoreChoiceText(normalize(radioOptionLabelFor(element)))
        }))
        .filter((choice) => choice.score > 1)
        .sort((a, b) => b.score - a.score);

      const preferred = choices[0];

      if (!preferred) {
        return;
      }

      checkRadio(preferred.element);

      if (preferred.element.checked) {
        result.selected.push({
          label: radioGroupLabelFor(elements),
          option: preferred.optionLabel
        });
      } else {
        result.warnings.push(`${radioGroupLabelFor(elements)} は手動選択が必要です。`);
      }
    });
  };

  const fillTextControl = (element: HTMLInputElement | HTMLTextAreaElement): void => {
    if (!visible(element) || element.disabled || element.readOnly) {
      return;
    }

    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (
      [
        "hidden",
        "password",
        "file",
        "submit",
        "button",
        "reset",
        "image",
        "checkbox",
        "radio",
        "range",
        "color"
      ].includes(type)
    ) {
      return;
    }

    const key = inferKey(element);
    if (!key || !values[key]) {
      return;
    }

    const value = element instanceof HTMLInputElement && key === "tel"
      ? telValueForElement(element)
      : element instanceof HTMLInputElement && key === "postalCode"
        ? postalCodeValueForElement(element)
        : values[key];

    setValue(element, value, key);
  };

  const checkConsent = (element: HTMLInputElement): void => {
    if (element.disabled || element.type !== "checkbox" || element.checked) {
      return;
    }

    const text = surroundingTextFor(element);
    if (!/(同意|承諾|確認|プライバシー|個人情報|個人情報保護|規約|privacy|policy)/i.test(text)) {
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
    const label = labelElementFor(element);
    (label || element).click();

    if (!element.checked) {
      if (descriptor?.set) {
        descriptor.set.call(element, true);
      } else {
        element.checked = true;
      }
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    result.checked.push({ label: text.slice(0, 120) });
  };

  document
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
    .forEach((element) => fillTextControl(element));

  document
    .querySelectorAll<HTMLSelectElement>("select")
    .forEach((element) => fillSelect(element));

  fillRadioGroups();

  document
    .querySelectorAll<HTMLInputElement>("input[type='checkbox']")
    .forEach((element) => checkConsent(element));

  document
    .querySelectorAll<HTMLSelectElement>("select[required], select[aria-required='true']")
    .forEach((element) => {
      if (!element.value) {
        result.warnings.push(`${shortLabelFor(element)} は手動選択が必要です。`);
      }
    });

  document
    .querySelectorAll<HTMLInputElement>("input[type='checkbox']")
    .forEach((element) => {
      const text = surroundingTextFor(element);

      if (/(同意|確認|プライバシー|個人情報|規約|privacy|policy)/i.test(text) && !element.checked) {
        result.warnings.push(`${shortLabelFor(element)} は手動確認が必要です。`);
      }
    });

  const requiredRadioNames = new Set<string>();
  document
    .querySelectorAll<HTMLInputElement>("input[type='radio'][required], input[type='radio'][aria-required='true']")
    .forEach((element) => {
      if (element.name) {
        requiredRadioNames.add(element.name);
      }
    });

  requiredRadioNames.forEach((name) => {
    const group = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type='radio'][name="${CSS.escape(name)}"]`));
    if (group.length > 0 && !group.some((element) => element.checked)) {
      result.warnings.push(`${radioGroupLabelFor(group)} は手動選択が必要です。`);
    }
  });

  if (result.filled.length === 0) {
    result.warnings.push("入力できる項目を自動判定できませんでした。フォーム項目名を確認してください。");
  }

  return result;
};

const pageFindSelectKeyboardTarget = (): SelectKeyboardTarget | null => {
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

    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
      const controls = parent.querySelectorAll("input, textarea, select").length;
      const text = parent.textContent?.trim() ?? "";

      if (controls <= 2 && text.length <= 160) {
        parts.push(text);
      }
    }

    const previous = element.previousElementSibling;
    if (previous?.textContent) {
      parts.push(previous.textContent.slice(0, 120));
    }

    ["aria-label", "placeholder", "name", "id"].forEach((attribute) => {
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

  const shortLabelFor = (element: HTMLElement): string => {
    const text = labelFor(element);

    if (text.includes("お問い合わせ種別")) {
      return "お問い合わせ種別";
    }

    return text.slice(0, 80) || element.getAttribute("name") || element.getAttribute("id") || element.tagName.toLowerCase();
  };

  const scoreOption = (option: HTMLOptionElement): number => {
    const text = normalize(option.textContent || option.value);

    if (!option.value) {
      return 0;
    }

    if (/(協業|パートナー|提携|業務委託|外注)/i.test(text)) {
      return 60;
    }

    if (/(プロジェクト|案件|仕事|ご相談|相談)/i.test(text)) {
      return 50;
    }

    if (/(web|ウェブ|制作|相談)/i.test(text)) {
      return 40;
    }

    if (/(その他|other)/i.test(text)) {
      return 30;
    }

    if (/(お問い合わせ|お問合せ|問い合わせ)/i.test(text)) {
      return 10;
    }

    return 1;
  };

  const isInquiryChoiceLabel = (text: string): boolean => {
    return /(お問い合わせ|お問合せ|問い合わせ|項目|種別|カテゴリ|カテゴリー|用件|ご用件|contact|inquiry|type|category)/i.test(text);
  };

  const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));

  for (let selectIndex = 0; selectIndex < selects.length; selectIndex += 1) {
    const element = selects[selectIndex];

    if (!visible(element) || element.disabled || element.value || !isInquiryChoiceLabel(labelFor(element))) {
      continue;
    }

    const preferred = Array.from(element.options)
      .map((option) => ({ option, score: scoreOption(option) }))
      .sort((a, b) => b.score - a.score)[0];

    if (!preferred || preferred.score <= 0) {
      continue;
    }

    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();

    return {
      label: shortLabelFor(element),
      option: preferred.option.textContent?.trim() || preferred.option.value,
      optionIndex: preferred.option.index,
      selectedIndex: element.selectedIndex,
      selectIndex,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  return null;
};

const pageReadSelectStatus = (selectIndex: number): SelectStatus | null => {
  const element = Array.from(document.querySelectorAll<HTMLSelectElement>("select"))[selectIndex];

  if (!element) {
    return null;
  }

  const selectedOption = element.options[element.selectedIndex];

  return {
    label: element.getAttribute("aria-label") || element.getAttribute("name") || element.getAttribute("id") || "select",
    option: selectedOption?.textContent?.trim() || element.value,
    value: element.value
  };
};

const runInPage = async (
  client: ChromeClient,
  payload: FormAutofillPayload,
  contextId?: number
): Promise<FormAutofillResult> => {
  const expression = `(${pageAutofill.toString()})(${JSON.stringify(payload)})`;
  const response = await client.Runtime.evaluate({
    expression,
    awaitPromise: true,
    returnByValue: true,
    contextId
  });

  return response.result?.value as FormAutofillResult;
};

const runInAvailablePageContexts = async (
  client: ChromeClient,
  payload: FormAutofillPayload,
  contextIds: Set<number>
): Promise<FormAutofillResult[]> => {
  const results: FormAutofillResult[] = [];
  const targets: Array<number | undefined> = [undefined, ...Array.from(contextIds)];
  const seen = new Set<string>();

  for (const contextId of targets) {
    const key = contextId === undefined ? "main" : String(contextId);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    try {
      results.push(await runInPage(client, payload, contextId));
    } catch {
      // Iframes can navigate or disappear while HubSpot and other embeds initialize.
    }
  }

  return results;
};

const findSelectKeyboardTarget = async (client: ChromeClient): Promise<SelectKeyboardTarget | null> => {
  const response = await client.Runtime.evaluate({
    expression: `(${pageFindSelectKeyboardTarget.toString()})()`,
    awaitPromise: true,
    returnByValue: true
  });

  return (response.result?.value as SelectKeyboardTarget | null) ?? null;
};

const readSelectStatus = async (
  client: ChromeClient,
  selectIndex: number
): Promise<SelectStatus | null> => {
  const response = await client.Runtime.evaluate({
    expression: `(${pageReadSelectStatus.toString()})(${selectIndex})`,
    awaitPromise: true,
    returnByValue: true
  });

  return (response.result?.value as SelectStatus | null) ?? null;
};

const dispatchKey = async (client: ChromeClient, key: "ArrowDown" | "Enter"): Promise<void> => {
  const keyMap = {
    ArrowDown: {
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 125
    },
    Enter: {
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 36
    }
  };
  const options = keyMap[key];

  await client.Input.dispatchKeyEvent({ type: "keyDown", ...options });
  await client.Input.dispatchKeyEvent({ type: "keyUp", ...options });
};

const selectDropdownsWithKeyboard = async (client: ChromeClient): Promise<FormAutofillResult> => {
  const result: FormAutofillResult = {
    filled: [],
    checked: [],
    selected: [],
    warnings: []
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const target = await findSelectKeyboardTarget(client);

    if (!target) {
      break;
    }

    await client.Input.dispatchMouseEvent({
      type: "mousePressed",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1
    });
    await client.Input.dispatchMouseEvent({
      type: "mouseReleased",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1
    });
    await sleep(300);

    const steps = Math.max(
      1,
      target.selectedIndex >= 0
        ? target.optionIndex - target.selectedIndex
        : target.optionIndex + 1
    );

    for (let step = 0; step < steps; step += 1) {
      await dispatchKey(client, "ArrowDown");
      await sleep(50);
    }

    await dispatchKey(client, "Enter");
    await sleep(500);

    const status = await readSelectStatus(client, target.selectIndex);

    if (status?.value) {
      result.selected.push({
        label: target.label,
        option: status.option || target.option
      });
      continue;
    }

    result.warnings.push(`${target.label} は手動選択が必要です。`);
    break;
  }

  return result;
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
    const contextIds = new Set<number>();

    try {
      await client.Page.enable();
      client.Runtime.executionContextCreated?.((event) => {
        const contextId = event.context?.id;

        if (contextId !== undefined) {
          contextIds.add(contextId);
        }
      });
      await client.Runtime.enable();
      const loaded = client.Page.loadEventFired();
      await client.Page.navigate({ url: candidate.formUrl });

      try {
        await withTimeout(loaded, options.timeoutMs);
      } catch {
        // Many contact pages keep background requests open. Filling can still work after a short wait.
        await sleep(2000);
      }

      await sleep(1500);

      const payload = {
        sender,
        formFieldAliases,
        candidate: {
          leadId: candidate.leadId,
          companyName: candidate.companyName,
          subject: candidate.subject,
          body: candidate.body
        }
      };
      const passResults = await runInAvailablePageContexts(client, payload, contextIds);

      await sleep(1000);
      passResults.push(...await runInAvailablePageContexts(client, payload, contextIds));

      passResults.push(await selectDropdownsWithKeyboard(client));

      await sleep(500);
      passResults.push(...await runInAvailablePageContexts(client, payload, contextIds));

      const result = mergeAutofillResults(passResults);

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
