import { execFile } from "child_process";
import http from "http";
import path from "path";
import { DEMO_PAGE_PATH_PATTERN, isRedirectedElsewhere } from "../collection/contactUrlVerifier";
import { FormCandidate } from "../contact/formCandidates";
import { FormFieldAliases, SenderInfo } from "../contact/salesMessage";
import { detectSalesForbidden } from "../domain/salesForbiddenDetection";

type ChromeRemoteInterface = {
  (options?: Record<string, unknown>): Promise<ChromeClient>;
  New: (options: Record<string, unknown>) => Promise<{ id: string }>;
  List: (options: Record<string, unknown>) => Promise<Array<{ id: string; type: string; url: string; parentId?: string }>>;
  Activate: (options: Record<string, unknown>) => Promise<void>;
  Close: (options: Record<string, unknown>) => Promise<void>;
};

export type ChromeClient = {
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
  captcha: string;
};

export type ConfirmStepStatus =
  | "advanced"
  | "no-confirm-button"
  | "validation-error"
  | "unknown"
  | "skipped";

export type ConfirmStepResult = {
  status: ConfirmStepStatus;
  label?: string;
  detail?: string;
};

export type CompletionSnapshot = {
  url: string;
  strictDone: boolean;
  looseDone: boolean;
  looksLikeConfirmPage: boolean;
  hasSubmitButton: boolean;
  cf7Sent: boolean;
  // MW WP Form の完了画面（URLが変わらず、同じページ内に完了メッセージが出る）
  mwWpFormComplete: boolean;
  // 入力欄（テキスト・メール・本文など）が画面に見えているか。完了メッセージに置き換わると false になる
  hasVisibleTextInputs: boolean;
  // 直前のページ遷移でリダイレクトが何回あったか（送信後に別ページへ転送されたかの判定用）
  redirectCount: number;
  referrer: string;
  // Contact Form 7 の送信状態（data-status）とエラー内容。CF7でないページでは空
  cf7Status: string;
  cf7Message: string;
  cf7Invalid: string[];
};

export type BrowserFillResult = {
  candidate: FormCandidate;
  result: FormAutofillResult;
  confirm: ConfirmStepResult;
  targetId: string;
  baseline: CompletionSnapshot | null;
  finalUrl: string;
  // デモページやトップへ転送された（本物のフォームではない）場合 true。確認ボタンの自動クリックと送信完了の自動検知を行わない
  wrongPage: boolean;
  // ページに営業お断りの記載があり、入力せずに中止した場合の該当文言（抜粋）
  salesForbidden?: string;
};

type BrowserFillOptions = {
  chromePort: number;
  timeoutMs: number;
  autoConfirm?: boolean;
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

      // 何回かに分けて入力するため、最初の回で空でも後の回で入力できた欄は警告から外す
      const requiredEmpty = /^必須項目が未入力です.*（(.*)）$/.exec(warning);
      if (requiredEmpty) {
        return (
          !filled.some((value) => value.field === requiredEmpty[1]) &&
          !selected.some((value) => value.label && warning.includes(value.label))
        );
      }

      if (!warning.includes("手動選択")) {
        return true;
      }

      return !selected.some((value) => value.label && warning.includes(value.label));
    });

  const captcha = results.map((result) => result.captcha).find((value) => value) ?? "";

  return {
    filled,
    checked,
    selected,
    warnings,
    captcha
  };
};

export const pageAutofill = (payload: FormAutofillPayload): FormAutofillResult => {
  const REQUIRED_EMPTY_WARNING = "必須項目が未入力です（手動で入力してください）: ";
  const detectCaptcha = (): string => {
    const recaptchaScripts = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[src*="recaptcha"]')
    );
    const hasRecaptchaV3 = recaptchaScripts.some((script) => /render=/.test(script.src));
    const hasRecaptchaV2 =
      !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha/api2/anchor"]') ||
      (recaptchaScripts.length > 0 && !hasRecaptchaV3);
    const hasHcaptcha = !!document.querySelector('.h-captcha, script[src*="hcaptcha"]');

    const labels: string[] = [];
    if (hasRecaptchaV3) labels.push("reCAPTCHA v3");
    else if (hasRecaptchaV2) labels.push("reCAPTCHA v2");
    if (hasHcaptcha) labels.push("hCaptcha");

    return labels.join("/");
  };

  const result: FormAutofillResult = {
    filled: [],
    checked: [],
    selected: [],
    warnings: [],
    captcha: detectCaptcha()
  };

  const values: Record<string, string> = {
    companyName: payload.sender.companyName,
    companyNameKana: payload.sender.companyNameKana,
    name: payload.sender.name,
    nameKana: payload.sender.nameKana,
    nameHiragana: payload.sender.nameHiragana,
    lastNameKana: payload.sender.nameKana.split(/\s+/)[0] || payload.sender.nameKana,
    firstNameKana: payload.sender.nameKana.split(/\s+/).slice(1).join(" ") || payload.sender.nameKana,
    lastNameHiragana: payload.sender.nameHiragana.split(/\s+/)[0] || payload.sender.nameHiragana,
    firstNameHiragana: payload.sender.nameHiragana.split(/\s+/).slice(1).join(" ") || payload.sender.nameHiragana,
    department: payload.sender.department,
    businessDescription: payload.sender.businessDescription,
    age: payload.sender.age,
    nameWithCompanyName: `${payload.sender.name}（${payload.sender.companyName}）`,
    lastName: payload.sender.name.split(/\s+/)[0] || payload.sender.name,
    firstName: payload.sender.name.split(/\s+/).slice(1).join(" ") || payload.sender.name,
    email: payload.sender.email,
    tel: payload.sender.tel,
    url: payload.sender.url,
    portfolioUrl: payload.sender.portfolioUrl,
    address: payload.sender.formAddress,
    cityStreetAddress: `${payload.sender.city}${payload.sender.streetAddress}`,
    prefectureCity: `${payload.sender.prefecture}${payload.sender.city}`,
    postalCode: payload.sender.postalCode,
    prefecture: payload.sender.prefecture,
    city: payload.sender.city,
    streetAddress: payload.sender.streetAddress,
    subject: payload.candidate.subject,
    japanCapital: "東京",
    body: payload.candidate.body
  };

  const builtinAliases: Record<string, string[]> = {
    companyName: [
      "会社名",
      "貴社名",
      "御社名",
      "法人名",
      "貴院名",
      "屋号",
      "組織名",
      "社名",
      "企業名",
      "団体名",
      "貴団体名",
      "会社・団体名",
      "会社/団体名",
      "会社･団体名",
      "企業・団体名",
      "法人・団体名",
      "会社・組織名",
      "会社・学校名",
      "店舗名",
      "企業・店舗名",
      "会社・店舗名",
      "勤務先",
      "お勤め先",
      "company",
      "organization",
      "org"
    ],
    name: ["お名前", "氏名", "担当者名", "ご担当者名", "担当者様名", "ご担当者様名", "担当者様", "代表者名", "代表者氏名", "name", "your-name"],
    nameKana: ["フリガナ", "ふりがな", "カナ", "氏名カナ", "氏名かな", "お名前カナ", "ご担当者名フリガナ", "kana", "furigana"],
    nameHiragana: ["ふりがな", "氏名かな", "お名前かな", "ご担当者名ふりがな"],
    businessDescription: ["事業内容", "業務内容", "主な事業", "事業概要", "業種"],
    department: ["部署", "部署名", "所属部署", "所属部署名", "部門", "部門名", "役職", "役職名", "ご役職", "肩書", "肩書き", "department", "division", "section", "position"],
    age: ["年齢", "歳", "age"],
    lastName: ["last name", "family name", "sei"],
    firstName: ["first name", "given name", "mei"],
    email: ["メールアドレス", "Email", "E-mail", "mail", "メール"],
    tel: ["電話番号", "TEL", "Tel", "tel", "phone", "mobile"],
    portfolioUrl: ["実績URL", "実績", "ポートフォリオ", "作品", "制作実績", "portfolio"],
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
    businessDescription: builtinAliases.businessDescription,
    department: [...builtinAliases.department, ...payload.formFieldAliases.department],
    age: [...builtinAliases.age, ...payload.formFieldAliases.age],
    email: [...builtinAliases.email, ...payload.formFieldAliases.email],
    tel: [...builtinAliases.tel, ...payload.formFieldAliases.tel],
    url: [...builtinAliases.url, ...payload.formFieldAliases.url],
    portfolioUrl: [...builtinAliases.portfolioUrl, ...payload.formFieldAliases.portfolioUrl],
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

  const isPlaceholderOption = (option: HTMLOptionElement | undefined | null): boolean => {
    if (!option) {
      return true;
    }

    const value = normalize(option.value || "");
    const text = normalize(option.textContent || "");

    return (
      !value ||
      /^(none|null|undefined|-+)$/.test(value) ||
      /(選択してください|選択して下さい|選択|お選びください|お選び下さい|please select)/i.test(text)
    );
  };

  const hasMeaningfulSelectValue = (element: HTMLSelectElement): boolean => {
    const selected = element.options[element.selectedIndex];

    if (element.value === "" || isPlaceholderOption(selected)) {
      return false;
    }

    // 先頭の選択肢がブラウザの既定で選ばれているだけ（selected指定なし）の場合は、選択済みとみなさない
    return element.selectedIndex > 0 || Boolean(selected?.defaultSelected) || element.options.length === 1;
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
    const isLikelyFieldLabel = (candidate: Element): boolean => {
      const tagName = candidate.tagName.toLowerCase();
      // <p class="contact_item">企業・店舗名</p> のように、項目名用のclassを持つ要素も項目名として扱う
      const className = typeof candidate.className === "string" ? candidate.className : "";
      return (
        tagName === "label" ||
        tagName === "dt" ||
        tagName === "th" ||
        candidate.getAttribute("role") === "label" ||
        (/^(p|div|span|h[2-6])$/.test(tagName) && /(label|item|title|ttl|head|name|komoku|midashi)/i.test(className))
      );
    };

    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label?.textContent) {
        parts.push(label.textContent);
      }
    }

    // Googleフォームのように、項目名を aria-labelledby で別の要素から参照している場合
    (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).forEach((labelId) => {
      const text = document.getElementById(labelId)?.textContent?.trim();
      if (text) {
        parts.push(text.slice(0, 120));
      }
    });

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
      if (
        previousContext &&
        isLikelyFieldLabel(previousContext) &&
        previousText &&
        previousText.length <= 160 &&
        previousControlCount === 0
      ) {
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
      "title",
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

  const fieldSpecificTextFor = (element: HTMLElement): string => {
    const parts: string[] = [];

    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const controls = parent.querySelectorAll("input, textarea, select").length;
      const text = parent.textContent?.trim() ?? "";

      if (controls === 1 && text && text.length <= 120) {
        parts.push(text);
        break;
      }
    }

    [
      "aria-label",
      "placeholder",
      "title",
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

    // 「セイ <input> メイ <input>」のように、1つの欄に複数の入力があり直前の文字だけが項目名になっている場合
    const previousNode = element.previousSibling;
    const previousText = previousNode?.nodeType === Node.TEXT_NODE ? previousNode.textContent?.trim() ?? "" : "";
    if (previousText && previousText.length <= 10) {
      parts.unshift(previousText);
    }

    return normalize(Array.from(new Set(parts)).join(" "));
  };

  const matches = (text: string, key: string): boolean => {
    // family_name / last-name のように、項目名の区切りが _ や - の場合も、スペース区切りの別名（family name など）と照合する
    const spacedText = text.replace(/[_-]+/g, " ");

    return aliases[key].some((alias) => {
      const normalizedAlias = normalize(alias);

      // mail / tel / org / zip / age / name のような短い英字の別名は、単語の一部（mailform の mail、message の age など）では一致させない
      if (/^[a-z]{2,4}$/.test(normalizedAlias)) {
        return new RegExp(`(^|[^a-z])${normalizedAlias}([^a-z]|$)`).test(spacedText);
      }

      return text.includes(normalizedAlias) || spacedText.includes(normalizedAlias.replace(/[_-]+/g, " "));
    });
  };

  // 項目名が「電話」だけの欄も電話番号欄として扱う（「電話番号」の別名には一致しないため）。
  // 「電話連絡の希望時間」「ご連絡方法（電話/メール）」のような欄は除く
  const matchesTel = (text: string): boolean => {
    return matches(text, "tel") || (text.includes("電話") && !/(時間|方法|手段|希望)/.test(text));
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

  // 「お名前」のような姓名一体の欄は、ラベル内にたまたま「姓」「名」の一文字が
  // 単独で含まれていなくても、split判定用のhasStandaloneJapaneseFieldに頼らず
  // ここで確実に除外する。firstName側にだけこのガードがあり、lastName側に無いと
  // 「お名前」欄が姓のみの値で埋まってしまう非対称なバグになるため、両方に適用する。
  const looksLikeCombinedNameField = (text: string): boolean => {
    return text.includes("会社名") || text.includes("法人名") || text.includes("お名前") || text.includes("氏名");
  };

  const matchesLastName = (text: string, autocomplete: string): boolean => {
    if (looksLikeCombinedNameField(text)) {
      return /family-name/.test(autocomplete) || matches(text, "lastName");
    }

    return /family-name/.test(autocomplete) || matches(text, "lastName") || hasStandaloneJapaneseField(text, "姓");
  };

  const matchesFirstName = (text: string, autocomplete: string): boolean => {
    if (looksLikeCombinedNameField(text)) {
      return /given-name/.test(autocomplete) || matches(text, "firstName");
    }

    return /given-name/.test(autocomplete) || matches(text, "firstName") || hasStandaloneJapaneseField(text, "名");
  };

  const matchesCompanyNameKana = (text: string): boolean => {
    return /(社名|法人名|企業名|団体名|屋号)/.test(text) && /(フリガナ|ふりがな|カナ|かな|kana|furigana)/i.test(text);
  };

  const matchesLastNameKana = (text: string): boolean => {
    return (
      (/(フリガナ|カナ|セイ|kana|furigana)/i.test(text) && (hasStandaloneJapaneseField(text, "姓") || hasStandaloneJapaneseField(text, "セイ"))) ||
      // family_kana / last-name-kana のような項目名
      /(family|last|sei)[\s_-]*(name[\s_-]*)?(kana|furigana)|(kana|furigana)[\s_-]*(family|last|sei)/i.test(text)
    );
  };

  const matchesFirstNameKana = (text: string): boolean => {
    return (
      (/(フリガナ|カナ|メイ|kana|furigana)/i.test(text) && (hasStandaloneJapaneseField(text, "名") || hasStandaloneJapaneseField(text, "メイ"))) ||
      // given_kana / first-name-kana のような項目名
      /(given|first|mei)[\s_-]*(name[\s_-]*)?(kana|furigana)|(kana|furigana)[\s_-]*(given|first|mei)/i.test(text)
    );
  };

  const matchesLastNameHiragana = (text: string): boolean => {
    return /(かな|ふりがな)/.test(text) && hasStandaloneJapaneseField(text, "姓");
  };

  const matchesFirstNameHiragana = (text: string): boolean => {
    return /(かな|ふりがな)/.test(text) && hasStandaloneJapaneseField(text, "名");
  };

  const matchesFullNameOnly = (text: string): boolean => {
    if (!/(お名前|氏名|担当者名|ご担当者名)/.test(text)) {
      return false;
    }

    return !hasStandaloneJapaneseField(text, "姓") && !hasStandaloneJapaneseField(text, "名");
  };

  const matchesCityStreetAddress = (text: string): boolean => {
    return /(市区町村|市町村|区市町村|市区郡町村).*(番地|住所)|(番地).*(市区町村|市町村|区市町村|市区郡町村)/.test(text);
  };

  const matchesOptionalBuilding = (text: string): boolean => {
    // 「番地・建物」のように番地と建物が1つの欄になっている場合は、番地として入力するので除く
    if (/(番地|丁目|以降の住所|町名)/.test(text)) {
      return false;
    }

    return /(マンション|ビル名|建物名|建物|部屋番号|号室|apartment|building|room)/i.test(text);
  };

  // 都道府県のプルダウンが直前にある住所欄は、都道府県を除いた住所（市区町村以降）を入れる
  const hasPrefectureSelectBefore = (element: HTMLElement): boolean => {
    let parent = element.parentElement;

    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const hasPrefectureSelect = Array.from(parent.querySelectorAll<HTMLSelectElement>("select")).some((select) => {
        const optionTexts = Array.from(select.options).map((option) => option.textContent?.trim() ?? "");
        const looksLikePrefectures = optionTexts.includes("北海道") && optionTexts.includes("沖縄県");

        return (
          looksLikePrefectures &&
          Boolean(select.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      });

      if (hasPrefectureSelect) {
        return true;
      }
    }

    return false;
  };

  // 「住所1」「住所2」/ address_1・address_2 のように番号付きの住所欄の番号
  const addressLineNumber = (text: string): number => {
    const match = /(住所|address)[\s_-]*([12１２])(?![0-9０-９])/i.exec(text);
    if (!match) {
      return 0;
    }

    return match[2] === "1" || match[2] === "１" ? 1 : 2;
  };

  const hasAddressLineField = (element: HTMLElement, line: number): boolean => {
    const scope: ParentNode = element.closest("form") ?? document;

    return Array.from(scope.querySelectorAll<HTMLElement>("input")).some(
      (other) => other !== element && visible(other) && addressLineNumber(labelFor(other)) === line
    );
  };

  // 同じフォーム内に、都道府県・市区町村を入れる別の欄があるか
  const hasOtherAddressField = (element: HTMLElement, key: "prefecture" | "city"): boolean => {
    const scope: ParentNode = element.closest("form") ?? document;

    return Array.from(scope.querySelectorAll<HTMLElement>("input, select")).some((other) => {
      if (other === element || !visible(other)) {
        return false;
      }

      const type = (other.getAttribute("type") || "text").toLowerCase();
      if (other.tagName.toLowerCase() === "input" && !["text", "search", ""].includes(type)) {
        return false;
      }

      return matches(labelFor(other), key);
    });
  };

  const inferKey = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
    const text = labelFor(element);
    const fieldText = fieldSpecificTextFor(element);
    const tagName = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();

    if (type === "email" || autocomplete === "email") {
      return "email";
    }

    // 項目名に post / zip だけがある郵便番号欄（例: address-post）が住所欄と誤判定されないようにする
    const nameHint = `${element.getAttribute("name") ?? ""} ${element.getAttribute("id") ?? ""}`;
    if (
      tagName === "input" &&
      /(^|[-_\s])(zip|zipcode|postcode|post|yubin)([-_\s\d]|$)/i.test(nameHint) &&
      !/post[-_ ]?(title|content|body|id)/i.test(nameHint)
    ) {
      return "postalCode";
    }

    if (matches(text, "postalCode")) {
      return "postalCode";
    }

    if (type === "tel" || autocomplete === "tel" || matchesTel(text)) {
      return "tel";
    }

    if (matches(text, "email")) {
      return "email";
    }

    // 「会社URL」のように「会社」を含むURL欄が会社名欄と誤判定されないよう、URL欄を先に判定する
    if (
      tagName === "input" &&
      (type === "url" ||
        /(会社|企業|貴社|御社|組織|法人)\s*(url|ホームページ|hp|サイト|web)/i.test(text) ||
        /(company|corp|organization)[-_ ]?(url|site|website|homepage)/i.test(text))
    ) {
      return matches(text, "portfolioUrl") ? "portfolioUrl" : "url";
    }

    // 「貴社の事業内容」が「内容」を含むため本文欄と誤判定されないよう、先に判定する
    if (matches(text, "businessDescription") && !/(お問い合わせ|お問合せ|問い合わせ|ご相談|相談)内容/.test(text)) {
      return "businessDescription";
    }

    if (tagName === "textarea" || matches(text, "body")) {
      return "body";
    }

    if (matches(text, "japanCapital")) {
      return "japanCapital";
    }

    if (matchesLastNameKana(fieldText)) {
      return "lastNameKana";
    }

    if (matchesFirstNameKana(fieldText)) {
      return "firstNameKana";
    }

    if (matchesLastNameHiragana(fieldText)) {
      return "lastNameHiragana";
    }

    if (matchesFirstNameHiragana(fieldText)) {
      return "firstNameHiragana";
    }

    if (matchesCompanyNameKana(text)) {
      return "companyNameKana";
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

    if (matches(text, "age")) {
      return "age";
    }

    // 「ご住所1（都道府県・市町村）」のように、都道府県と市区町村を1つの入力欄に入れる場合
    if (
      tagName === "input" &&
      matches(text, "prefecture") &&
      /(市区町村|市町村|区市町村|市区郡町村)/.test(text) &&
      !/(番地|丁目)/.test(text)
    ) {
      return "prefectureCity";
    }

    if (matches(text, "prefecture")) {
      return "prefecture";
    }

    if (matchesOptionalBuilding(text)) {
      return "";
    }

    // 「住所1」「住所2」に分かれている欄は、住所2を建物名などの続きとして空欄にし、
    // 市区町村の欄が別にあれば住所1には番地以降だけを入れる
    const addressLine = addressLineNumber(text);
    if (addressLine === 2 && hasAddressLineField(element, 1)) {
      // 「住所2（番地・マンション名）」のように番地を入れる欄なら番地以降、それ以外は建物名用として空欄
      return /(番地|丁目|町名)/.test(text) ? "streetAddress" : "";
    }

    if (addressLine === 1 && hasOtherAddressField(element, "city")) {
      return "streetAddress";
    }

    if (matchesCityStreetAddress(text)) {
      return "cityStreetAddress";
    }

    if (matches(text, "city")) {
      return "city";
    }

    if (matches(text, "streetAddress")) {
      // 「ご住所 ※住所の続き（番地など）を入力」のように注意書きに番地とあるだけの欄は、
      // 都道府県・市区町村の欄が別に無ければ住所全体（市区町村が無ければ市区町村から）を入れる
      if (hasOtherAddressField(element, "city")) {
        return "streetAddress";
      }

      if (hasOtherAddressField(element, "prefecture") || hasPrefectureSelectBefore(element)) {
        return "cityStreetAddress";
      }

      if (matches(text, "address")) {
        return "address";
      }

      return "streetAddress";
    }

    if (matches(text, "address")) {
      return hasPrefectureSelectBefore(element) ? "cityStreetAddress" : "address";
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

    if (matchesLastName(fieldText, autocomplete)) {
      return "lastName";
    }

    if (matchesFirstName(fieldText, autocomplete)) {
      return "firstName";
    }

    if (matches(text, "name")) {
      return "name";
    }

    if (matches(text, "subject")) {
      return "subject";
    }

    if (matches(text, "portfolioUrl")) {
      return "portfolioUrl";
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

  // 郵便番号の「自動入力」ボタンなど、分割入力欄と同じ場所にあるボタン類を数えないための判定
  const textLikeInput = (element: HTMLInputElement): boolean => {
    return !["button", "submit", "reset", "image", "hidden", "checkbox", "radio", "file"].includes(
      (element.getAttribute("type") || "text").toLowerCase()
    );
  };

  const telLike = (element: HTMLInputElement): boolean => {
    const type = (element.getAttribute("type") || "").toLowerCase();
    if (!textLikeInput(element)) {
      return false;
    }

    const text = labelFor(element);
    if (matches(text, "postalCode")) {
      return false;
    }

    return type === "tel" || matchesTel(text);
  };

  const postalCodeLike = (element: HTMLInputElement): boolean => {
    if (!textLikeInput(element)) {
      return false;
    }

    const text = labelFor(element);
    return matches(text, "postalCode");
  };

  const splitTelPartLike = (element: HTMLInputElement): boolean => {
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
      /(tel|phone|mobile|電話).*(1|2|3|01|02|03|a|b|c)|(^|[_-])(1|2|3|01|02|03|a|b|c)($|[_-])/i.test(label) ||
      (maxLength > 0 && maxLength <= 4) ||
      (size > 0 && size <= 4)
    );
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

      if (controls.length === parts.length && controls.every((input) => splitTelPartLike(input))) {
        const index = controls.indexOf(element);

        if (index >= 0 && index < parts.length) {
          return parts[index];
        }
      }
    }

    return payload.sender.tel;
  };

  const postalCodeValueForElement = (element: HTMLInputElement): string => {
    const fullPostalCode = (): string => {
      const hyphenless = payload.sender.postalCode.replace(/\D/g, "");
      const placeholder = element.getAttribute("placeholder") ?? "";
      // 他の項目の注記を拾わないよう、この欄のラベル・すぐ近くの文字・入力例だけを見る
      const ownTextOf = (node: Element | null): string =>
        node
          ? Array.from(node.childNodes)
              .filter((child) => child.nodeType === Node.TEXT_NODE)
              .map((child) => child.textContent?.trim() ?? "")
              .join(" ")
              .slice(0, 100)
          : "";
      const label = labelFor(element);
      const hintText = [
        label.length <= 120 ? label : "",
        ownTextOf(element.parentElement),
        ownTextOf(element.parentElement?.parentElement ?? null),
        element.previousElementSibling?.textContent?.trim().slice(0, 60) ?? "",
        placeholder,
        element.getAttribute("aria-label") ?? ""
      ].join(" ");
      const pattern = element.getAttribute("pattern") ?? "";
      const placeholderDigits = placeholder.replace(/\D/g, "");
      // 「ハイフンなし」の注記、7桁以内のmaxlength、7桁だけのpattern・入力例がある場合は、ハイフンなしで入れる
      const wantsHyphenless =
        /(ハイフン\s*(なし|無し|不要|抜き|を除|は?入れない|なしで)|半角数字のみ|数字のみ|no\s*hyphen)/i.test(hintText) ||
        (element.maxLength > 0 && element.maxLength <= 7) ||
        /^\^?(\\d|\[0-9\])\{7\}\$?$/.test(pattern) ||
        (placeholderDigits.length === 7 && !/[-ー−―‐]/.test(placeholder));

      return wantsHyphenless && hyphenless.length === 7 ? hyphenless : payload.sender.postalCode;
    };
    const parts = splitJapanesePostalCode(payload.sender.postalCode);

    if (parts.length < 2) {
      return fullPostalCode();
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

    return fullPostalCode();
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

  // 問い合わせ種別などの選択肢の「営業メールの用件に合うか」を点数にする。協業系 > 営業・提案系 > その他 > 一般のお問い合わせ > 他社サービスの依頼系
  const scoreChoiceText = (text: string): number => {
    if (/(採用|求人|応募|リクルート|見積|資料請求|取材|クレーム|修理|購入|注文|不具合|解約|退会|取材|メディア)/i.test(text)) {
      return 0;
    }

    if (/(弊社webサイトを見て|webサイトを見て|ホームページを見て|公式サイト|website)/i.test(text)) {
      return 70;
    }

    if (/(協業|パートナー|提携|業務委託|外注|アライアンス|協力会社)/i.test(text)) {
      return 90;
    }

    if (/(営業|提案|売り込み|セールス|(貴社|御社).{0,10}(サービス|商品|製品).{0,14}紹介)/i.test(text)) {
      return 80;
    }

    // パートナー登録フォームの「職種」では、Webエンジニアに当たるものを選ぶ
    if (/(エンジニア|コーダー|プログラマ|フロントエンド)/i.test(text)) {
      return 75;
    }

    // 協業・営業提案の選択肢が無い場合は「その他」を選ぶ（Web制作・システム開発などは依頼する側の選択肢なので選ばない）
    if (/(その他|other|上記以外)/i.test(text)) {
      return 65;
    }

    if (/(お問い合わせ|お問合せ|問い合わせ)/i.test(text)) {
      return 55;
    }

    if (/(ご相談|相談)/i.test(text)) {
      return 40;
    }

    if (/(商談|プロジェクト|案件|仕事)/i.test(text)) {
      return 30;
    }

    // 依頼向けの選択肢しか無い場合は、Webサイト制作に近いもの（CM・動画などの映像系を除く）を優先する
    if (/(web|ウェブ|ホームページ|サイト)/i.test(text) && !/(cm|tv|テレビ|動画|映像)/i.test(text)) {
      // 「WEB広告」より「サイト・LP制作」のような制作の選択肢を優先する
      return /(制作|構築|作成|開発|リニューアル)/.test(text) ? 27 : 25;
    }

    if (/(web|ウェブ|制作|開発|システム)/i.test(text)) {
      return 20;
    }

    return 1;
  };

  const scoreOption = (option: HTMLOptionElement): number => {
    if (isPlaceholderOption(option)) {
      return 0;
    }

    return scoreChoiceText(normalize(option.textContent || option.value));
  };

  const isInquiryChoiceLabel = (text: string): boolean => {
    return /(お問い合わせ|お問合せ|問い合わせ|問合わせ|項目|種別|カテゴリ|カテゴリー|用件|ご用件|件名|内容選択|contact|inquiry|type|category)/i.test(text);
  };

  const fillPrefectureSelect = (element: HTMLSelectElement): boolean => {
    if (element.disabled || !matches(labelFor(element), "prefecture")) {
      return false;
    }

    const prefecture = normalize(payload.sender.prefecture);
    const selectedOption = element.options[element.selectedIndex];
    const selectedText = normalize(selectedOption?.textContent || "");

    // 最初から別の県（例: 鹿児島県）が選ばれているフォームがあるため、送信者の都道府県と一致する時だけそのままにする
    if (hasMeaningfulSelectValue(element) && (selectedText.includes(prefecture) || normalize(element.value) === prefecture)) {
      result.selected.push({
        label: shortLabelFor(element),
        option: selectedOption?.textContent?.trim() || element.value
      });
      return true;
    }

    const preferred = Array.from(element.options).find((option) => {
      if (isPlaceholderOption(option)) {
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

  // 市区町村のプルダウン（都道府県を選ぶと選択肢が入れ替わるものを含む）
  const fillCitySelect = (element: HTMLSelectElement): boolean => {
    if (element.disabled || !matches(labelFor(element), "city") || matches(labelFor(element), "prefecture")) {
      return false;
    }

    const city = normalize(payload.sender.city);
    const preferred = Array.from(element.options).find((option) => !isPlaceholderOption(option) && normalize(option.textContent || option.value).includes(city));

    if (!preferred) {
      result.warnings.push(`${shortLabelFor(element)} は手動選択が必要です。`);
      return true;
    }

    element.value = preferred.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    result.selected.push({ label: shortLabelFor(element), option: preferred.textContent?.trim() || preferred.value });
    return true;
  };

  const fillSelect = (element: HTMLSelectElement): void => {
    if (fillPrefectureSelect(element)) {
      return;
    }

    if (fillCitySelect(element)) {
      return;
    }

    if (element.disabled || !isInquiryChoiceLabel(labelFor(element))) {
      return;
    }

    if (hasMeaningfulSelectValue(element)) {
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

  // ラジオボタンの見出し（「お問い合わせ目的」など）。入力欄の外側にある見出し文字を、祖先要素の直下の文字から集める
  const ancestorHeadingTextFor = (element: HTMLElement): string => {
    const texts: string[] = [];
    let ancestor: HTMLElement | null = element.parentElement;

    for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      const own = Array.from(ancestor.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 80);

      if (own) {
        texts.push(own);
      }

      // 見出しが、入力欄を囲む要素の直前の兄弟要素（<br>を挟む場合を含む）にあるケース
      let previous = ancestor.previousElementSibling;

      for (let count = 0; previous && count < 3; count += 1, previous = previous.previousElementSibling) {
        if (previous.querySelector("input, select, textarea")) {
          break;
        }

        const previousText = previous.textContent?.trim().slice(0, 60) ?? "";

        if (previousText) {
          texts.push(previousText);
          break;
        }
      }
    }

    return texts.join(" ");
  };

  const radioGroupLabelFor = (elements: HTMLInputElement[]): string => {
    const first = elements[0];

    if (first.name) {
      return normalize(`${first.name} ${ancestorHeadingTextFor(first)}`);
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

  const checkInput = (element: HTMLInputElement): void => {
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

  const checkRadio = (element: HTMLInputElement): void => {
    checkInput(element);
  };

  // 「希望の連絡方法」などの選択欄では、メールを選ぶ
  const isContactMethodLabel = (text: string): boolean => {
    return /(希望.{0,4}(連絡|返信|回答)(方法|手段)|(連絡|返信|回答|ご連絡|ご返信)(方法|手段)|お問い合わせ方法|お問合せ方法|contact\s*method|preferred\s*contact|how.{0,10}contact)/i.test(text);
  };

  const isEmailChoiceText = (text: string): boolean => {
    return /(メール|e-?mail|ｅメール|電子メール)/i.test(text) && !/(メールアドレス)/.test(text);
  };

  const fillContactMethodChoices = (): void => {
    const radioGroups = new Map<string, HTMLInputElement[]>();

    document.querySelectorAll<HTMLInputElement>("input[type='radio']").forEach((element) => {
      if (element.disabled || !radioVisible(element)) {
        return;
      }

      const formKey = element.form?.id || element.form?.getAttribute("name") || "form";
      const key = `${formKey}:name:${element.name || radioGroupLabelFor([element])}`;
      radioGroups.set(key, [...(radioGroups.get(key) ?? []), element]);
    });

    radioGroups.forEach((elements) => {
      const groupLabel = radioGroupLabelFor(elements);

      if (!isContactMethodLabel(groupLabel)) {
        return;
      }

      const emailChoice = elements.find((element) => isEmailChoiceText(radioOptionLabelFor(element)));

      if (!emailChoice) {
        return;
      }

      if (!emailChoice.checked) {
        checkRadio(emailChoice);
      }

      if (emailChoice.checked) {
        result.selected.push({ label: groupLabel, option: radioOptionLabelFor(emailChoice) });
      } else {
        result.warnings.push(`${groupLabel} は手動選択が必要です。`);
      }
    });

    document.querySelectorAll<HTMLSelectElement>("select").forEach((element) => {
      if (element.disabled || !isContactMethodLabel(labelFor(element))) {
        return;
      }

      const emailOption = Array.from(element.options).find((option) => isEmailChoiceText(option.textContent || option.value));

      if (!emailOption) {
        return;
      }

      element.value = emailOption.value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));

      if (element.value === emailOption.value) {
        result.selected.push({ label: shortLabelFor(element), option: emailOption.textContent?.trim() || emailOption.value });
      }
    });

    const checkboxGroups = new Map<string, HTMLInputElement[]>();

    document.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((element) => {
      if (element.disabled || !radioVisible(element) || !element.name) {
        return;
      }

      const key = `${element.form?.id || "form"}:name:${element.name}`;
      checkboxGroups.set(key, [...(checkboxGroups.get(key) ?? []), element]);
    });

    checkboxGroups.forEach((elements) => {
      const groupLabel = `${checkboxGroupLabelFor(elements)} ${surroundingTextFor(elements[0]).slice(0, 80)}`;

      if (elements.length < 2 || !isContactMethodLabel(groupLabel)) {
        return;
      }

      const emailChoice = elements.find((element) => isEmailChoiceText(checkboxOptionLabelFor(element)));

      if (emailChoice && !emailChoice.checked) {
        checkInput(emailChoice);
      }

      if (emailChoice?.checked) {
        result.selected.push({ label: checkboxGroupLabelFor(elements), option: checkboxOptionLabelFor(emailChoice) });
      }
    });
  };

  // HubSpotの新しいフォームなどにある、クリックで開く独自のプルダウン（role="combobox" と role="option" の一覧）
  const fillComboboxes = (): void => {
    document.querySelectorAll<HTMLInputElement>("input[role='combobox']").forEach((element) => {
      if (element.disabled || !visible(element) || element.value.trim() !== "") {
        return;
      }

      const label = labelFor(element);
      const required = element.required || element.getAttribute("aria-required") === "true";

      if (!isInquiryChoiceLabel(label) && !required) {
        return;
      }

      const listboxId = element.getAttribute("aria-controls") ?? "";
      const optionsIn = (): HTMLElement[] => {
        const listbox = listboxId ? document.getElementById(listboxId) : null;
        return Array.from((listbox ?? element.closest("div")?.parentElement ?? document).querySelectorAll<HTMLElement>("[role='option']"));
      };

      if (optionsIn().length === 0) {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        element.click();
      }

      const preferred = optionsIn()
        .map((option) => ({ option, text: option.textContent?.trim() ?? "", score: scoreChoiceText(normalize(option.textContent ?? "")) }))
        .filter((choice) => choice.score > 1)
        .sort((a, b) => b.score - a.score)[0];

      if (!preferred) {
        return;
      }

      preferred.option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      preferred.option.click();
      result.selected.push({ label: shortLabelFor(element), option: preferred.text });
    });
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
      const groupLabel = radioGroupLabelFor(elements);

      // 「個人情報の取り扱い ◯同意する」のようなラジオボタン形式の同意欄
      if (/(同意|プライバシー|個人情報|規約|privacy|policy)/i.test(`${groupLabel} ${nearestPreviousLabelText(elements[0])}`)) {
        const agree = elements.find((element) => {
          const option = radioOptionLabelFor(element);
          return /(同意する|同意します|同意の上|承諾|agree|accept)/i.test(option) && !/(同意しない|しない|disagree)/i.test(option);
        });

        if (agree) {
          if (!agree.checked) {
            checkRadio(agree);
          }

          if (agree.checked) {
            result.checked.push({ label: groupLabel.slice(0, 120) });
          }
          return;
        }
      }

      const isInquiry = isInquiryRadioGroup(elements);

      // 種別以外でも、必須の選択欄は合う選択肢（その他など）があれば選ぶ
      if (!isInquiry && (elements.some((element) => element.checked) || !isRequiredChoiceGroup(elements, groupLabel))) {
        return;
      }

      const alreadyChecked = elements.find((element) => element.checked);

      if (alreadyChecked) {
        // 初期値で選ばれている項目より、用件に合う項目（協業など）が明らかに良ければ選び直す
        const currentScore = scoreChoiceText(normalize(radioOptionLabelFor(alreadyChecked)));
        const better = elements
          .map((element) => ({
            element,
            optionLabel: radioOptionLabelFor(element),
            score: scoreChoiceText(normalize(radioOptionLabelFor(element)))
          }))
          .filter((choice) => choice.element !== alreadyChecked && choice.score >= 60 && choice.score >= currentScore + 10)
          .sort((a, b) => b.score - a.score)[0];

        if (better) {
          checkRadio(better.element);

          if (better.element.checked) {
            result.selected.push({ label: radioGroupLabelFor(elements), option: better.optionLabel });
            return;
          }
        }

        result.selected.push({
          label: radioGroupLabelFor(elements),
          option: radioOptionLabelFor(alreadyChecked)
        });
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

  const checkboxOptionLabelFor = (element: HTMLInputElement): string => {
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

    if (parent && parent.querySelectorAll("input[type='checkbox']").length <= 1 && parent.textContent) {
      parts.push(parent.textContent);
    }

    // name は同じグループの全選択肢で共通（例: ご相談内容[data][]）なので、選択肢の点数づけに混ぜない
    ["aria-label", "value", "id"].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) {
        parts.push(value);
      }
    });

    return Array.from(new Set(parts.map((part) => part.trim()).filter(Boolean))).join(" ").slice(0, 120);
  };

  const checkboxGroupLabelFor = (elements: HTMLInputElement[]): string => {
    const first = elements[0];
    const formKey = first.name ? normalize(first.name.replace(/\[.*$/, "")) : "";
    const ownTextOf = (node: HTMLElement): string =>
      Array.from(node.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
    let fallback = "";
    const ownTexts: string[] = [];

    let parent = first.parentElement;
    for (let depth = 0; parent && depth < 7; depth += 1, parent = parent.parentElement) {
      const container = parent;
      const sharesName = elements.every((element) => element.name === first.name);
      const groupCount = elements.filter((element) => container.contains(element)).length;
      // 同じ name の選択肢（選択肢ごとに name が違うまとまりでは、まとまりに入っていないチェックボックス）が混ざったら行き過ぎ
      const extraCount = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='checkbox']")).filter(
        (element) => !elements.includes(element) && (!sharesName || element.name === first.name)
      ).length;
      const text = parent.textContent?.trim() ?? "";

      // 選択肢1つを囲む label などはまだグループ全体ではないので、さらに上をたどる
      if (groupCount < elements.length) {
        continue;
      }

      if (extraCount > 0 || text.length > 600) {
        break;
      }

      const own = ownTextOf(parent);
      if (own) {
        ownTexts.push(own);
      }

      // 見出しは、選択肢（入力欄）を含まない子要素の文字。別の選択肢を見出しと取り違えないようにする
      const heading = Array.from(parent.children)
        .filter((child) => !child.querySelector("input, select, textarea"))
        .map((child) => child.textContent?.trim() ?? "")
        .find((textContent) => textContent.length > 0 && textContent.length <= 80 && !isChoiceNoteText(textContent));

      if (heading) {
        return normalize(`${ownTexts.join(" ")} ${heading} ${formKey}`);
      }

      // 「ご相談内容<br><label>…」のように見出しが文字だけで書かれている場合
      if (ownTexts.length > 0) {
        return normalize(`${ownTexts.join(" ")} ${formKey}`);
      }

      fallback = fallback || text;
    }

    return normalize(`${fallback} ${formKey}`.trim()) || normalize(first.getAttribute("name") || first.getAttribute("id") || "checkbox");
  };

  // 「複数選択可」「必須」のような注記は項目名として扱わない
  const isChoiceNoteText = (text: string): boolean => {
    return /^(\(|（)?(複数選択可|複数回答可|複数選択|いずれか|必須|任意|※.*)(\)|）)?$/.test(text.trim());
  };

  // 選択肢のまとまりを囲む要素の、直前の兄弟要素に書かれた項目名（入力欄を含む要素の手前で止める）
  const nearestPreviousLabelText = (element: HTMLElement): string => {
    let ancestor: HTMLElement | null = element.parentElement;

    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      let previous = ancestor.previousElementSibling;

      for (let count = 0; previous && count < 3; count += 1, previous = previous.previousElementSibling) {
        if (previous.querySelector("input, select, textarea")) {
          break;
        }

        const text = previous.textContent?.trim() ?? "";
        if (text && !isChoiceNoteText(text)) {
          return normalize(text.slice(0, 60));
        }
      }
    }

    return "";
  };

  // 必須の選択欄か（required属性、CF7の必須class、見出しの「必須」「※」表示）。
  // normalize すると「必須」の表示が消えるため、ここでは整形前の文字を見る
  const isRequiredChoiceGroup = (elements: HTMLInputElement[], label: string): boolean => {
    if (
      elements.some(
        (element) =>
          element.required ||
          element.getAttribute("aria-required") === "true" ||
          element.closest(".wpcf7-validates-as-required, [aria-required='true']") !== null
      ) ||
      /required/i.test(label)
    ) {
      return true;
    }

    const requiredMarker = /(必須|\*|＊|※)/;
    let ancestor: HTMLElement | null = elements[0].parentElement;

    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      const container = ancestor;
      const hasOtherControls = Array.from(container.querySelectorAll<HTMLElement>("input, select, textarea")).some(
        (control) =>
          !elements.includes(control as HTMLInputElement) &&
          !["hidden"].includes((control.getAttribute("type") || "").toLowerCase()) &&
          !((control as HTMLInputElement).name || "").startsWith(elements[0].name)
      );

      if (hasOtherControls) {
        break;
      }

      const previous = container.previousElementSibling;
      if (previous && !previous.querySelector("input, select, textarea") && requiredMarker.test((previous.textContent ?? "").slice(0, 80))) {
        return true;
      }

      // 見出しが選択肢と同じ要素の中にある場合（選択肢の文字は除いて調べる）
      const ownText = Array.from(container.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && !node.querySelector("input")))
        .map((node) => node.textContent ?? "")
        .join(" ");
      if (requiredMarker.test(ownText.slice(0, 120))) {
        return true;
      }
    }

    return false;
  };

  const isContactTopicCheckboxGroup = (text: string): boolean => {
    return /(ご相談内容|相談内容|問い?合わ?せ(の)?(内容|項目|種別|種類)|用件|ご用件|ご興味|種別|種類|カテゴリ|件名|内容選択|title|category)/i.test(text);
  };

  const isReferralSourceCheckboxGroup = (text: string): boolean => {
    return /(知ったきっかけ|きっかけ|流入|紹介|認知|acc|referral|source)/i.test(text);
  };

  const fillCheckboxGroups = (): void => {
    const groups = new Map<string, HTMLInputElement[]>();

    document
      .querySelectorAll<HTMLInputElement>("input[type='checkbox']")
      .forEach((element) => {
        if (element.disabled || !radioVisible(element) || !element.name) {
          return;
        }

        const formKey = element.form?.id || element.form?.getAttribute("name") || "form";
        const key = `${formKey}:name:${element.name}`;
        const current = groups.get(key) ?? [];
        current.push(element);
        groups.set(key, current);
      });

    // 「<input name="業務提携">業務提携 <input name="その他">その他」のように選択肢ごとに name が違うものは、
    // 同じ要素の中に並んでいる分を1つの選択欄としてまとめる
    const singles = Array.from(groups.entries()).filter(([, elements]) => elements.length === 1);
    const merged = new Map<Element, HTMLInputElement[]>();

    singles.forEach(([key, [element]]) => {
      let container: HTMLElement | null = element.parentElement;

      for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
        const siblings = singles.filter(([, [other]]) => container!.contains(other));

        if (siblings.length >= 2) {
          // 同意欄など別の用途のチェックボックスと混ざらないよう、入力欄（テキスト等）を含む範囲まで広げない
          if (container.querySelector("textarea, select, input:not([type='checkbox']):not([type='hidden'])")) {
            break;
          }

          groups.delete(key);
          merged.set(container, [...(merged.get(container) ?? []), element]);
          break;
        }
      }
    });

    merged.forEach((elements, container) => {
      groups.set(`merged:${Array.from(groups.keys()).length}:${container.tagName}`, elements);
    });

    groups.forEach((elements) => {
      if (elements.some((element) => element.checked)) {
        return;
      }

      const groupLabel = checkboxGroupLabelFor(elements);
      const labelWithHeading = `${groupLabel} ${nearestPreviousLabelText(elements[0])}`;
      const isTopic = isContactTopicCheckboxGroup(labelWithHeading) || isReferralSourceCheckboxGroup(labelWithHeading);

      if (!isTopic && !isRequiredChoiceGroup(elements, groupLabel)) {
        return;
      }

      const ranked = elements
        .map((element) => ({
          element,
          optionLabel: checkboxOptionLabelFor(element),
          score: scoreChoiceText(normalize(checkboxOptionLabelFor(element)))
        }))
        .filter((choice) => choice.score > 1)
        .sort((a, b) => b.score - a.score);

      if (ranked.length === 0) {
        return;
      }

      // 最高点が同点の項目は、複数選択できる欄なので3つまでまとめて選ぶ。
      // ただしWeb制作などの依頼向けの選択肢しか無い場合（30点未満）は、近いもの1つだけにする
      const best = ranked[0].score;
      // 種別以外の必須欄（応募内容など）は、いちばん近いもの1つだけにする
      const picks = ranked.filter((choice) => choice.score === best).slice(0, best < 30 || !isTopic ? 1 : 3);

      picks.forEach((preferred) => {
        checkInput(preferred.element);

        if (preferred.element.checked) {
          result.selected.push({
            label: groupLabel,
            option: preferred.optionLabel
          });
        } else {
          result.warnings.push(`${groupLabel} は手動選択が必要です。`);
        }
      });
    });
  };

  // 「全角でご入力ください」と書かれた欄には、半角英数字・記号・スペースを全角に直して入れる
  const fullWidthKeys = new Set([
    "companyName",
    "name",
    "lastName",
    "firstName",
    "nameWithCompanyName",
    "department",
    "address",
    "cityStreetAddress",
    "streetAddress",
    "city",
    "subject"
  ]);

  const toFullWidth = (value: string): string => {
    return value
      .replace(/[!-~]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0))
      .replace(/ /g, "\u3000");
  };

  // 入力欄の直後に続く注記（<br>を挟んだ「※ 全角でご入力ください」など）。別の入力欄が出てきたら止める
  const followingNotes = (anchor: Element): string => {
    const notes: string[] = [];
    let sibling = anchor.nextElementSibling;

    for (let count = 0; sibling && count < 4; count += 1, sibling = sibling.nextElementSibling) {
      if (sibling.querySelector("input, select, textarea") || /^(input|select|textarea)$/i.test(sibling.tagName)) {
        break;
      }

      const text = sibling.textContent?.trim().slice(0, 60) ?? "";

      if (text) {
        notes.push(text);
      }
    }

    return notes.join(" ");
  };

  const fullWidthHintTextFor = (element: HTMLInputElement | HTMLTextAreaElement): string => {
    const ownTextOf = (node: Element | null): string =>
      node
        ? Array.from(node.childNodes)
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent?.trim() ?? "")
            .join(" ")
            .slice(0, 100)
        : "";
    const anchor = element.closest(".wpcf7-form-control-wrap") ?? element;
    const label = labelFor(element);

    return [
      label.length <= 120 ? label : "",
      ownTextOf(element.parentElement),
      ownTextOf(anchor.parentElement),
      anchor.previousElementSibling?.textContent?.trim().slice(0, 60) ?? "",
      followingNotes(anchor),
      element.getAttribute("placeholder") ?? "",
      element.getAttribute("aria-label") ?? ""
    ].join(" ");
  };

  const requiresFullWidth = (element: HTMLInputElement | HTMLTextAreaElement): boolean => {
    const hintText = fullWidthHintTextFor(element);

    if (/(全角.{0,4}半角|半角.{0,4}全角|どちらでも)/.test(hintText)) {
      return false;
    }

    return /全角/.test(hintText) && !/半角(英数|数字)/.test(hintText);
  };

  // フリガナ欄の姓名の間のスペース: 入力例が半角スペースならそのまま、全角スペースなら全角、全角指定のみで入力例が無ければ
  // 「スペースの記載があれば全角スペース、無ければスペースなし」にする（半角スペースで全角エラーになるのを避ける）
  const kanaKeys = new Set(["nameKana", "nameHiragana", "lastNameKana", "firstNameKana", "lastNameHiragana", "firstNameHiragana", "companyNameKana"]);

  const adjustKanaSpacing = (element: HTMLInputElement | HTMLTextAreaElement, value: string): string => {
    if (!/[ \u3000]/.test(value)) {
      return value;
    }

    const placeholder = element.getAttribute("placeholder") ?? "";

    if (/[ァ-ヶぁ-ゖー] [ァ-ヶぁ-ゖー]/.test(placeholder)) {
      return value;
    }

    if (/[ァ-ヶぁ-ゖー]\u3000[ァ-ヶぁ-ゖー]/.test(placeholder)) {
      return value.replace(/ /g, "\u3000");
    }

    if (!requiresFullWidth(element)) {
      return value;
    }

    return /スペース|空白|空け/.test(fullWidthHintTextFor(element)) ? value.replace(/ /g, "\u3000") : value.replace(/[ \u3000]/g, "");
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

    const rawValue = element instanceof HTMLInputElement && key === "tel"
      ? telValueForElement(element)
      : element instanceof HTMLInputElement && key === "postalCode"
        ? postalCodeValueForElement(element)
        : values[key];
    const value = kanaKeys.has(key)
      ? adjustKanaSpacing(element, rawValue)
      : fullWidthKeys.has(key) && requiresFullWidth(element)
        ? toFullWidth(rawValue)
        : rawValue;

    setValue(element, value, key);
  };

  // 同意の文言がチェックボックスを囲む label の外（例: <p><label><input></label><a>プライバシーポリシー</a>に同意する</p>）にある場合も読む
  const consentTextFor = (element: HTMLInputElement): string => {
    const block = element.closest("p, li, dd, td, div");
    const blockText = block && block.querySelectorAll("input[type='checkbox']").length <= 1 ? block.textContent ?? "" : "";

    return normalize(`${surroundingTextFor(element)} ${blockText.slice(0, 200)}`);
  };

  // テーマのメニュー開閉用チェックボックス（本文にプライバシーポリシー等のリンクが含まれて誤認される）を除外する
  const isConsentCandidate = (element: HTMLInputElement): boolean => {
    const identity = `${element.id} ${element.name} ${typeof element.className === "string" ? element.className : ""}`;

    if (/(menu|navi|sidebar|search|toggle|drawer|hamburger|accordion)/i.test(identity)) {
      return false;
    }

    return document.querySelector("form") === null || element.closest("form") !== null;
  };

  const checkConsent = (element: HTMLInputElement): void => {
    if (element.disabled || element.type !== "checkbox" || element.checked || !isConsentCandidate(element)) {
      return;
    }

    const text = consentTextFor(element);
    if (!/(同意|承諾|確認|プライバシー|個人情報|個人情報保護|規約|privacy|policy|チェックを入れ|スパム|spam)/i.test(text)) {
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

  // 本文欄が複数ある場合（お困りごと・依頼内容・補足など）は、必須の欄か「内容」に当たる欄1つだけに本文を入れる
  const skippedBodyTextareas = new Set<HTMLTextAreaElement>();
  const bodyTextareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).filter(
    (element) => visible(element) && !element.disabled && !element.readOnly && inferKey(element) === "body"
  );

  if (bodyTextareas.length > 1) {
    const isRequired = (element: HTMLTextAreaElement): boolean =>
      element.required ||
      element.getAttribute("aria-required") === "true" ||
      /validates-as-required/.test(element.className);
    const descriptor = (element: HTMLTextAreaElement): string =>
      `${element.name} ${element.id} ${element.getAttribute("placeholder") ?? ""} ${surroundingTextFor(element)}`;
    const primary =
      bodyTextareas.find((element) => isRequired(element)) ??
      bodyTextareas.find(
        (element) =>
          /(内容|message|detail|inquiry|body|依頼|ご相談)/i.test(descriptor(element)) &&
          !/(補足|備考|その他|課題|困りごと)/.test(descriptor(element))
      ) ??
      bodyTextareas[0];

    bodyTextareas.forEach((element) => {
      if (element !== primary) {
        skippedBodyTextareas.add(element);
      }
    });
  }

  document
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
    .forEach((element) => {
      if (element instanceof HTMLTextAreaElement && skippedBodyTextareas.has(element)) {
        return;
      }

      fillTextControl(element);
    });

  document
    .querySelectorAll<HTMLSelectElement>("select")
    .forEach((element) => fillSelect(element));

  fillContactMethodChoices();

  fillComboboxes();

  fillRadioGroups();

  fillCheckboxGroups();

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

      if (isConsentCandidate(element) && /(同意|確認|プライバシー|個人情報|規約|privacy|policy)/i.test(text) && !element.checked) {
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

  // 必須なのに空のまま残った入力欄（希望日時・自由記述の質問など自動で決められない欄）を知らせる。
  // 「必須」の表示は誤判定しやすいので、required属性などはっきりした印がある欄だけを対象にする
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((element) => {
    const type = (element.getAttribute("type") || "text").toLowerCase();

    if (
      ["hidden", "checkbox", "radio", "submit", "button", "reset", "image", "file"].includes(type) ||
      element.disabled ||
      (element.readOnly && element.getAttribute("role") !== "combobox") ||
      !visible(element) ||
      element.value.trim() !== ""
    ) {
      return;
    }

    const required =
      element.required || element.getAttribute("aria-required") === "true" || /validates-as-required/.test(element.className);

    if (required) {
      const key = element.getAttribute("name") || element.getAttribute("id") || "";
      result.warnings.push(`${REQUIRED_EMPTY_WARNING}${shortLabelFor(element)}（${key}）`);
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

    // Googleフォームのように、項目名を aria-labelledby で別の要素から参照している場合
    (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).forEach((labelId) => {
      const text = document.getElementById(labelId)?.textContent?.trim();
      if (text) {
        parts.push(text.slice(0, 120));
      }
    });

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

  // 問い合わせ種別などの選択肢の「営業メールの用件に合うか」を点数にする。協業系 > 営業・提案系 > その他 > 一般のお問い合わせ > 他社サービスの依頼系
  const scoreChoiceText = (text: string): number => {
    if (/(採用|求人|応募|リクルート|見積|資料請求|取材|クレーム|修理|購入|注文|不具合|解約|退会|取材|メディア)/i.test(text)) {
      return 0;
    }

    if (/(弊社webサイトを見て|webサイトを見て|ホームページを見て|公式サイト|website)/i.test(text)) {
      return 70;
    }

    if (/(協業|パートナー|提携|業務委託|外注|アライアンス|協力会社)/i.test(text)) {
      return 90;
    }

    if (/(営業|提案|売り込み|セールス|(貴社|御社).{0,10}(サービス|商品|製品).{0,14}紹介)/i.test(text)) {
      return 80;
    }

    // パートナー登録フォームの「職種」では、Webエンジニアに当たるものを選ぶ
    if (/(エンジニア|コーダー|プログラマ|フロントエンド)/i.test(text)) {
      return 75;
    }

    // 協業・営業提案の選択肢が無い場合は「その他」を選ぶ（Web制作・システム開発などは依頼する側の選択肢なので選ばない）
    if (/(その他|other|上記以外)/i.test(text)) {
      return 65;
    }

    if (/(お問い合わせ|お問合せ|問い合わせ)/i.test(text)) {
      return 55;
    }

    if (/(ご相談|相談)/i.test(text)) {
      return 40;
    }

    if (/(商談|プロジェクト|案件|仕事)/i.test(text)) {
      return 30;
    }

    // 依頼向けの選択肢しか無い場合は、Webサイト制作に近いもの（CM・動画などの映像系を除く）を優先する
    if (/(web|ウェブ|ホームページ|サイト)/i.test(text) && !/(cm|tv|テレビ|動画|映像)/i.test(text)) {
      // 「WEB広告」より「サイト・LP制作」のような制作の選択肢を優先する
      return /(制作|構築|作成|開発|リニューアル)/.test(text) ? 27 : 25;
    }

    if (/(web|ウェブ|制作|開発|システム)/i.test(text)) {
      return 20;
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
    return /(お問い合わせ|お問合せ|問い合わせ|問合わせ|項目|種別|カテゴリ|カテゴリー|用件|ご用件|件名|内容選択|contact|inquiry|type|category)/i.test(text);
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


type ConfirmClickResult = { clicked: boolean; label: string; candidates: string[] };

const pageClickConfirmButton = (): ConfirmClickResult => {
  const isVisible = (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const labelOf = (element: HTMLElement): string => {
    const input = element as HTMLInputElement;

    return (
      input.value ||
      element.innerText ||
      element.textContent ||
      element.getAttribute("aria-label") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
  };
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, input[type="submit"], input[type="button"], a[role="button"]'
    )
  ).filter((element) => isVisible(element) && !(element as HTMLButtonElement).disabled);
  const candidates = elements.map(labelOf).filter(Boolean);
  const confirmPattern = /(確認|confirm|review)/i;
  const excludePattern = /(送信|送る|submit|send|戻る|戻|修正|キャンセル|クリア|リセット|reset|cancel|back|ログイン|検索)/i;
  // 「送信内容確認」「入力内容を確認」「送信前の確認」は確認画面へ進むボタンなので押してよい。
  // 「確認して送信」「確認の上送信」は送信まで進む可能性があるので押さない
  const confirmOnlyPattern = /(送信内容|入力内容|送信前).{0,4}確認/;
  const sendAfterConfirmPattern = /確認.{0,4}(して|の上|後).{0,3}(送信|送る)/;
  const isConfirmButton = (label: string): boolean => {
    if (!confirmPattern.test(label)) {
      return false;
    }

    if (confirmOnlyPattern.test(label) && !sendAfterConfirmPattern.test(label) && !/(戻|修正|キャンセル|クリア|リセット)/.test(label)) {
      return true;
    }

    return !excludePattern.test(label);
  };
  const target = elements.find((element) => isConfirmButton(labelOf(element)));

  if (!target) {
    return { clicked: false, label: "", candidates: candidates.slice(0, 8) };
  }

  const label = labelOf(target);
  target.scrollIntoView({ block: "center" });
  target.click();

  return { clicked: true, label, candidates: [] };
};

type ConfirmStateResult = {
  url: string;
  errors: string[];
  looksLikeConfirmPage: boolean;
};

const pageReadConfirmState = (): ConfirmStateResult => {
  const text = (document.body?.innerText ?? "").slice(0, 6000);
  const errorSelectors = [
    ".wpcf7-not-valid-tip",
    ".error",
    ".errors",
    ".is-error",
    ".parsley-errors-list li",
    '[aria-invalid="true"]',
    '[class*="error"]:not(input):not(textarea):not(select)'
  ];
  const errors = Array.from(document.querySelectorAll<HTMLElement>(errorSelectors.join(",")))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const message = (element.innerText || "").trim();

      return rect.width > 0 && rect.height > 0 && message.length > 0 && message.length <= 120;
    })
    .map((element) => (element.innerText || "").trim())
    .slice(0, 5);
  const invalidCount = document.querySelectorAll("form :invalid").length;

  if (invalidCount > 0 && errors.length === 0) {
    errors.push(`未入力・形式エラーの項目が${invalidCount}件あります`);
  }

  return {
    url: location.href,
    errors,
    looksLikeConfirmPage: /(入力内容.{0,6}確認|内容を?ご確認|確認画面|以下の内容で|この内容で|内容でよろしければ)/.test(text)
  };
};

const pageReadCompletionSnapshot = (): CompletionSnapshot => {
  const text = (document.body?.innerText ?? "").slice(0, 6000);
  const submitButtonPattern = /(送信|送る|submit|send)/i;
  const hasSubmitButton = Array.from(
    document.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"]')
  ).some((element) => {
    const rect = element.getBoundingClientRect();
    const label = (element as HTMLInputElement).value || element.innerText || "";

    return rect.width > 0 && rect.height > 0 && submitButtonPattern.test(label);
  });

  return {
    url: location.href,
    strictDone: /(送信が完了|送信完了|送信いたしました|送信されました|受け付けました|受付完了|受付いたしました|送信を完了)/.test(text),
    looseDone:
      /(ありがとうございました|ありがとうございます|thank you|thanks|完了)/i.test(text) ||
      /\/(thanks?|thank-you|thankyou|complete|completed|done|finish|sent|success)(\/|\.|$|\?)/i.test(location.pathname),
    looksLikeConfirmPage: /(入力内容.{0,6}確認|内容を?ご確認|確認画面|以下の内容で|この内容で|内容でよろしければ)/.test(text),
    hasSubmitButton,
    cf7Sent: !!document.querySelector(".wpcf7-mail-sent-ok, .wpcf7 form.sent, .wpcf7-form.sent"),
    mwWpFormComplete: !!document.querySelector(".mw_wp_form_complete"),
    hasVisibleTextInputs: Array.from(
      document.querySelectorAll<HTMLElement>(
        'textarea, input[type="text"], input[type="email"], input[type="tel"], input:not([type])'
      )
    ).some((element) => {
      const rect = element.getBoundingClientRect();

      return rect.width > 0 && rect.height > 0;
    }),
    redirectCount:
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.redirectCount ?? 0,
    referrer: document.referrer,
    cf7Status: document.querySelector("form.wpcf7-form")?.getAttribute("data-status") ?? "",
    cf7Message: (document.querySelector(".wpcf7-response-output")?.textContent ?? "").trim().slice(0, 200),
    cf7Invalid: Array.from(document.querySelectorAll(".wpcf7-not-valid-tip"))
      .map((tip) => {
        const fieldName = tip.closest(".wpcf7-form-control-wrap")?.getAttribute("data-name") ?? "";

        return `${fieldName}: ${(tip.textContent ?? "").trim()}`.slice(0, 80);
      })
      .slice(0, 6)
  };
};

export const readCompletionSnapshot = async (client: ChromeClient): Promise<CompletionSnapshot | null> => {
  const response = await client.Runtime.evaluate({
    expression: `(${pageReadCompletionSnapshot.toString()})()`,
    awaitPromise: true,
    returnByValue: true
  });

  return (response.result?.value as CompletionSnapshot | undefined) ?? null;
};

// 送信完了画面（またはCF7のインライン完了表示）に変わったかを、入力直後のスナップショットと比べて判定する
export const isFormCompleted = (baseline: CompletionSnapshot | null, current: CompletionSnapshot): boolean => {
  const urlChanged = !baseline || baseline.url !== current.url;

  if (current.cf7Sent && !baseline?.cf7Sent) {
    return true;
  }

  if (current.mwWpFormComplete && !baseline?.mwWpFormComplete) {
    return true;
  }

  if (current.strictDone && !baseline?.strictDone) {
    return true;
  }

  // URLが変わらないまま、フォームが消えて「ありがとうございました」等に置き換わったページ内完了
  if (
    !urlChanged &&
    current.looseDone &&
    !baseline?.looseDone &&
    !current.looksLikeConfirmPage &&
    !current.hasSubmitButton &&
    !current.hasVisibleTextInputs
  ) {
    return true;
  }

  if (urlChanged && current.looseDone && !current.looksLikeConfirmPage && !current.hasSubmitButton) {
    return true;
  }

  return false;
};

// Contact Form 7 が送信エラー（入力不備・スパム判定・送信失敗など）を返している場合、その内容を返す
export const describeCf7SubmitError = (snapshot: CompletionSnapshot): string | null => {
  const labels: Record<string, string> = {
    invalid: "入力内容に問題があります",
    spam: "スパムと判定されました",
    failed: "送信に失敗しました",
    aborted: "送信が中断されました",
    unaccepted: "同意がされていません"
  };
  const label = labels[snapshot.cf7Status];

  if (!label) {
    return null;
  }

  return [`${label}（${snapshot.cf7Status}）`, snapshot.cf7Message, snapshot.cf7Invalid.join(" / ")].filter(Boolean).join(" - ");
};

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "";
  }
};

// 完了画面が無く、送信後にサイトのトップへ転送されるフォームの判定（送信できたかは断定できないため「要確認」扱い）
export const isProbableSubmitRedirectToTop = (baseline: CompletionSnapshot | null, current: CompletionSnapshot): boolean => {
  if (!baseline) {
    return false;
  }

  const baselinePath = pathOf(baseline.url);
  const currentPath = pathOf(current.url);
  const isTop = currentPath === "/" || /^\/index\.(html?|php)$/i.test(currentPath);

  return (
    isTop &&
    baselinePath !== "/" &&
    new URL(baseline.url).origin === new URL(current.url).origin &&
    current.redirectCount >= 1 &&
    pathOf(current.referrer) === baselinePath
  );
};

const runConfirmStep = async (client: ChromeClient, contextIds: Set<number>): Promise<ConfirmStepResult> => {
  const targets: Array<number | undefined> = [undefined, ...Array.from(contextIds)];
  let lastCandidates: string[] = [];

  for (const contextId of targets) {
    try {
      const response = await client.Runtime.evaluate({
        expression: `(${pageClickConfirmButton.toString()})()`,
        awaitPromise: true,
        returnByValue: true,
        contextId
      });
      const clicked = response.result?.value as ConfirmClickResult | undefined;

      if (!clicked) {
        continue;
      }

      if (!clicked.clicked) {
        lastCandidates = clicked.candidates.length > 0 ? clicked.candidates : lastCandidates;
        continue;
      }

      await sleep(2500);

      const stateResponse = await client.Runtime.evaluate({
        expression: `(${pageReadConfirmState.toString()})()`,
        awaitPromise: true,
        returnByValue: true
      });
      const state = stateResponse.result?.value as ConfirmStateResult | undefined;

      if (state && state.errors.length > 0) {
        return { status: "validation-error", label: clicked.label, detail: state.errors.join(" / ") };
      }

      if (state?.looksLikeConfirmPage) {
        return { status: "advanced", label: clicked.label };
      }

      return {
        status: "unknown",
        label: clicked.label,
        detail: "確認ボタンを押しましたが、確認画面に進んだか判定できませんでした"
      };
    } catch {
      // The page may navigate while clicking, or the iframe context may be gone.
    }
  }

  return {
    status: "no-confirm-button",
    detail: lastCandidates.length > 0 ? `ボタン: ${lastCandidates.join(" / ")}` : "確認ボタンが見つかりませんでした"
  };
};


// 選択肢の点数づけ（pageAutofill内のscoreChoiceTextと同じ基準。タブ選択のためページ内へ関数ごと渡す）
const scoreChoiceTextForTabs = (text: string): number => {
  if (/(採用|求人|応募|リクルート|見積|資料請求|取材|クレーム|修理|購入|注文|不具合|解約|退会|メディア)/i.test(text)) {
    return 0;
  }

  if (/(協業|パートナー|提携|業務委託|外注|アライアンス|協力会社)/i.test(text)) {
    return 90;
  }

  if (/(営業|提案|売り込み|(貴社|御社).{0,10}(サービス|商品|製品).{0,14}紹介)/i.test(text)) {
    return 80;
  }

  if (/(その他|other|上記以外)/i.test(text)) {
    return 65;
  }

  if (/(お問い合わせ|お問合せ|問い合わせ)/i.test(text)) {
    return 55;
  }

  return 1;
};

type TabSelectResult = { clicked: boolean; label: string; tabs: string[] };

// お問い合わせ種別ごとにタブでフォームが切り替わるページで、協業・提案向けのタブを選ぶ
const pageSelectBestTab = (score: (text: string) => number): TabSelectResult => {
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  const isVisible = (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };

  if (document.querySelectorAll("form").length < 2) {
    return { clicked: false, label: "", tabs: [] };
  }

  const candidates: Array<{ target: HTMLElement; text: string; active: boolean }> = [];

  document.querySelectorAll<HTMLElement>('[role="tab"]').forEach((element) => {
    candidates.push({
      target: element,
      text: normalize(element.innerText || element.textContent || ""),
      active: element.getAttribute("aria-selected") === "true"
    });
  });

  document.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((element) => {
    if (!/tab/i.test(`${element.name} ${element.id} ${typeof element.className === "string" ? element.className : ""}`)) {
      return;
    }

    const label =
      element.closest("label") ??
      (element.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(element.id)}"]`) : null);
    const text = normalize(label?.textContent || element.value || "");

    if (!text) {
      return;
    }

    candidates.push({ target: (label as HTMLElement | null) ?? element, text, active: element.checked });
  });

  const tabs = candidates.map((candidate) => candidate.text);

  if (candidates.length < 2) {
    return { clicked: false, label: "", tabs };
  }

  const best = candidates
    .map((candidate) => ({ candidate, score: score(candidate.text) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 60 || best.candidate.active) {
    return { clicked: false, label: best?.candidate.active ? best.candidate.text : "", tabs };
  }

  best.candidate.target.click();

  return { clicked: true, label: best.candidate.text, tabs };
};

const runTabSelection = async (client: ChromeClient): Promise<TabSelectResult | null> => {
  try {
    const response = await client.Runtime.evaluate({
      expression: `(${pageSelectBestTab.toString()})(${scoreChoiceTextForTabs.toString()})`,
      awaitPromise: true,
      returnByValue: true
    });

    return (response.result?.value as TabSelectResult | undefined) ?? null;
  } catch {
    return null;
  }
};

type FormPresenceInfo = { forms: number; externalIframes: string[]; turnstile: boolean };

const pageReadFormPresence = (): FormPresenceInfo => {
  const contentForms = Array.from(document.querySelectorAll("form")).filter(
    (form) => !form.matches('[role="search"], .search-box, .search-form, .searchform') && !/[?&]s=|\/search/i.test(form.getAttribute("action") ?? "")
  );
  const externalIframes = Array.from(document.querySelectorAll("iframe"))
    .map((frame) => frame.src)
    .filter((src) => src && !/(googletagmanager|doubleclick|youtube|google\.com\/maps|facebook|twitter|instagram)/i.test(src));

  const turnstile = Boolean(
    document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com"], script[src*="turnstile"]')
  );

  return { forms: contentForms.length, externalIframes, turnstile };
};

const readFormPresence = async (client: ChromeClient): Promise<FormPresenceInfo | null> => {
  try {
    const response = await client.Runtime.evaluate({
      expression: `(${pageReadFormPresence.toString()})()`,
      awaitPromise: true,
      returnByValue: true
    });

    return (response.result?.value as FormPresenceInfo | undefined) ?? null;
  } catch {
    return null;
  }
};

// 外部サービス（BowNow・formrunなど）のフォームがiframeで埋め込まれている場合、そのiframeのターゲットに接続して入力する
const IGNORED_IFRAME_URL = /(recaptcha|googletagmanager|doubleclick|youtube|facebook|twitter|instagram|google\.com\/maps)/i;

const fillIframeForms = async (
  CDP: ChromeRemoteInterface,
  port: number,
  parentTargetId: string,
  payload: FormAutofillPayload
): Promise<FormAutofillResult[]> => {
  const results: FormAutofillResult[] = [];
  let targets: Array<{ id: string; type: string; url: string; parentId?: string }> = [];

  try {
    targets = (await CDP.List({ port })).filter(
      (entry) => entry.type === "iframe" && entry.parentId === parentTargetId && !IGNORED_IFRAME_URL.test(entry.url)
    );
  } catch {
    return results;
  }

  for (const iframeTarget of targets) {
    try {
      const iframeClient = await CDP({ port, target: iframeTarget.id });

      try {
        await iframeClient.Runtime.enable();
        results.push(await runInPage(iframeClient, payload));
        await sleep(800);
        results.push(await runInPage(iframeClient, payload));
      } finally {
        await iframeClient.close();
      }
    } catch {
      // The iframe may have navigated or closed while connecting.
    }
  }

  return results;
};

// 外部サービスのiframe（別プロセス）内にある確認ボタンを押す
const runConfirmStepInIframes = async (
  CDP: ChromeRemoteInterface,
  port: number,
  parentTargetId: string
): Promise<ConfirmStepResult | null> => {
  let targets: Array<{ id: string; type: string; url: string; parentId?: string }> = [];

  try {
    targets = (await CDP.List({ port })).filter(
      (entry) => entry.type === "iframe" && entry.parentId === parentTargetId && !IGNORED_IFRAME_URL.test(entry.url)
    );
  } catch {
    return null;
  }

  for (const iframeTarget of targets) {
    try {
      const iframeClient = await CDP({ port, target: iframeTarget.id });

      try {
        await iframeClient.Runtime.enable();
        const confirm = await runConfirmStep(iframeClient, new Set());

        if (confirm.status !== "no-confirm-button") {
          return confirm;
        }
      } finally {
        await iframeClient.close();
      }
    } catch {
      // The iframe may have navigated or closed while connecting.
    }
  }

  return null;
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
    warnings: [],
    captcha: ""
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

      const locationResponse = await client.Runtime.evaluate({
        expression: "location.href",
        returnByValue: true
      }).catch(() => undefined);
      const finalUrl = typeof locationResponse?.result?.value === "string" ? locationResponse.result.value : candidate.formUrl;
      const redirected = isRedirectedElsewhere(candidate.formUrl, finalUrl);
      let wrongPage = false;

      if (redirected) {
        try {
          const finalPath = new URL(finalUrl).pathname.replace(/\/+$/, "") || "/";
          wrongPage = DEMO_PAGE_PATH_PATTERN.test(finalPath) || finalPath === "/";
        } catch {
          wrongPage = false;
        }
      }

      const pageTextResponse = await client.Runtime.evaluate({
        expression: "document.body ? document.body.innerText : ''",
        returnByValue: true
      }).catch(() => undefined);
      const salesForbidden = detectSalesForbidden(
        typeof pageTextResponse?.result?.value === "string" ? pageTextResponse.result.value : ""
      );

      if (salesForbidden) {
        // 営業お断りの記載があるページには入力せず、タブを閉じて中止する
        results.push({
          candidate,
          result: { filled: [], checked: [], selected: [], warnings: [`営業お断りの記載を検出したため入力を中止しました: 「${salesForbidden}」`], captcha: "" },
          confirm: { status: "skipped", detail: "営業お断りの記載があるため中止しました" },
          targetId: target.id,
          baseline: null,
          finalUrl,
          wrongPage: true,
          salesForbidden
        });
        await CDP.Close({ port: options.chromePort, id: target.id }).catch(() => undefined);
        continue;
      }

      const tabSelection = await runTabSelection(client);

      if (tabSelection?.clicked) {
        await sleep(800);
      }

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
      passResults.push(...await fillIframeForms(CDP, options.chromePort, target.id, payload));

      const result = mergeAutofillResults(passResults);
      let confirm: ConfirmStepResult = { status: "skipped" };
      const presence = await readFormPresence(client);

      if (presence?.turnstile) {
        result.warnings.push(
          "Cloudflare Turnstile（ボット対策）があります。確認が表示された場合は、画面で操作してください。送信できない場合は「自分で入力」で、普段のブラウザから送信してください。"
        );
      }

      if (presence && presence.forms === 0) {
        if (presence.externalIframes.length > 0 && result.filled.length > 0) {
          // 外部サービスのiframeへ入力できた
        } else if (presence.externalIframes.length > 0) {
          result.warnings.push(
            `このページ本体には入力フォームがなく、外部サービスのフォーム(iframe)が埋め込まれています。自動入力が効かない可能性があるため、手動で入力してください。`
          );
        } else {
          wrongPage = true;
          result.warnings.push(
            `このページに入力フォーム(<form>)が見つかりません。フォームURLが正しいか確認してください。確認ボタンの自動クリックと送信の自動記録は行いません。`
          );
        }
      }

      if (redirected) {
        result.warnings.push(
          wrongPage
            ? `フォームURLが別ページ(${finalUrl})へ転送されました。本物のフォームではない可能性が高いため、確認ボタンの自動クリックと送信の自動記録は行いません。`
            : `フォームURLが別ページ(${finalUrl})へ転送されました。転送先のフォームか確認してください。`
        );
      }

      if (wrongPage) {
        confirm = { status: "skipped", detail: "転送先が本物のフォームではない可能性があります" };
      } else if (options.autoConfirm === false) {
        confirm = { status: "skipped", detail: "自動で確認画面へ進む設定がOFFです" };
      } else if (result.captcha) {
        confirm = { status: "skipped", detail: "CAPTCHAがあるため手動対応です" };
      } else if (result.warnings.length > 0 || result.filled.length === 0) {
        confirm = { status: "skipped", detail: "入力の警告があるため、確認ボタンは押していません" };
      } else {
        confirm = await runConfirmStep(client, contextIds);

        if (confirm.status === "no-confirm-button" && presence && presence.externalIframes.length > 0) {
          confirm = (await runConfirmStepInIframes(CDP, options.chromePort, target.id)) ?? confirm;
        }

        if (confirm.status === "validation-error") {
          result.warnings.push(`確認ボタンを押しましたが入力エラーがあります: ${confirm.detail ?? ""}`);
        }
      }

      const baseline = await readCompletionSnapshot(client).catch(() => null);

      results.push({ candidate, result, confirm, targetId: target.id, baseline, finalUrl, wrongPage });
      await notify(
        "フォーム入力を確認してください",
        confirm.status === "advanced"
          ? `${candidate.leadId} ${candidate.companyName}: 確認画面まで進めました。内容を確認し、問題なければ送信ボタンを押してください。`
          : `${candidate.leadId} ${candidate.companyName}: 入力内容を確認し、問題なければ送信ボタンを押してください。`
      );
    } finally {
      await client.close();
    }
  }

  return results;
};
