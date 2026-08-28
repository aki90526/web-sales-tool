import { chromium } from "playwright-core";
import { loadConfig } from "../config/env";
import {
  buildSalesMessage,
  readSalesContentConfig,
  SalesContentConfig,
  SenderInfo
} from "../contact/salesMessage";
import { createSheetsClient } from "../google/sheetsClient";
import {
  readSalesManagementTable,
  SalesManagementLead
} from "../google/salesManagementRepository";

type CliOptions = {
  browserChannel: string;
  dryRun: boolean;
  force: boolean;
  headless: boolean;
  help: boolean;
  leadId: string;
  noPause: boolean;
  timeoutMs: number;
};

type AssistField = {
  key: string;
  label: string;
  value: string;
  aliases: string[];
};

type FillResult = {
  key: string;
  label: string;
  status: "filled" | "not_found" | "skipped";
  matchedText?: string;
  element?: string;
  reason?: string;
};

const DEFAULT_BROWSER_CHANNEL = "chrome";
const DEFAULT_TIMEOUT_MS = 30000;

const printHelp = (): void => {
  console.log(`Usage:
  npm run forms:assist -- --lead-id L-0003
  npm run forms:assist -- --lead-id L-0003 --dry-run
  npm run forms:assist -- --lead-id L-0003 --browser-channel chrome

Options:
  --lead-id           自動入力するリードID
  --dry-run           ブラウザを開かず、入力予定項目だけ表示します
  --force             ステータスや次回対応日の警告を無視します
  --browser-channel   使用するブラウザ。省略時は ${DEFAULT_BROWSER_CHANNEL}
  --headless          画面を表示せずに実行します。通常運用では非推奨
  --no-pause          入力後にEnter待ちせず終了します
  --timeout-ms        ページ読み込み待ち時間。省略時は ${DEFAULT_TIMEOUT_MS}
`);
};

const nextValue = (args: string[], index: number, name: string): string => {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
};

const parsePositiveInteger = (value: string, name: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    browserChannel: process.env.FORM_ASSIST_BROWSER_CHANNEL || DEFAULT_BROWSER_CHANNEL,
    dryRun: false,
    force: false,
    headless: false,
    help: false,
    leadId: "",
    noPause: false,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--lead-id") {
      options.leadId = nextValue(argv, index, "--lead-id");
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--browser-channel") {
      options.browserChannel = nextValue(argv, index, "--browser-channel");
      index += 1;
    } else if (arg === "--headless") {
      options.headless = true;
    } else if (arg === "--no-pause") {
      options.noPause = true;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(nextValue(argv, index, "--timeout-ms"), "--timeout-ms");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.help && !options.leadId) {
    throw new Error("--lead-id is required");
  }

  return options;
};

const isValidUrl = (value: string): boolean => {
  return /^https?:\/\//i.test(value);
};

const formatTokyoDate = (date: Date): string => {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

const isFutureDate = (dateText: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return false;
  }

  return dateText > formatTokyoDate(new Date());
};

const validateLead = (lead: SalesManagementLead, force: boolean): void => {
  if (!isValidUrl(lead.contactFormUrl)) {
    throw new Error(`${lead.leadId} has no valid form URL`);
  }

  if (lead.contactMethod !== "問い合わせフォーム" && !force) {
    throw new Error(`${lead.leadId} is not marked as 問い合わせフォーム. Use --force to override.`);
  }

  if (lead.status !== "送信待ち" && !force) {
    throw new Error(`${lead.leadId} status is ${lead.status || "(blank)"}. Use --force to override.`);
  }

  if (isFutureDate(lead.nextActionDate) && !force) {
    throw new Error(`${lead.leadId} next action date is ${lead.nextActionDate}. Use --force to override.`);
  }
};

const buildAssistFields = (
  sender: SenderInfo,
  contentConfig: SalesContentConfig,
  subject: string,
  body: string
): AssistField[] => {
  return [
    {
      key: "companyName",
      label: "会社名",
      value: sender.companyName,
      aliases: contentConfig.formFieldAliases.companyName
    },
    {
      key: "name",
      label: "氏名",
      value: sender.name,
      aliases: contentConfig.formFieldAliases.name
    },
    {
      key: "email",
      label: "メールアドレス",
      value: sender.email,
      aliases: contentConfig.formFieldAliases.email
    },
    {
      key: "tel",
      label: "電話番号",
      value: sender.tel,
      aliases: contentConfig.formFieldAliases.tel
    },
    {
      key: "url",
      label: "URL",
      value: sender.url,
      aliases: contentConfig.formFieldAliases.url
    },
    {
      key: "subject",
      label: "件名",
      value: subject,
      aliases: contentConfig.formFieldAliases.subject
    },
    {
      key: "body",
      label: "本文",
      value: body,
      aliases: contentConfig.formFieldAliases.body
    }
  ];
};

const printFields = (lead: SalesManagementLead, fields: AssistField[], templateId: string): void => {
  console.log(`${lead.leadId} ${lead.companyName}`);
  console.log(`Form URL: ${lead.contactFormUrl}`);
  console.log(`Template: ${templateId}`);
  console.log("");
  console.log("Input fields:");
  fields.forEach((field) => {
    console.log(`- ${field.label}: ${field.value}`);
  });
};

const autofillForm = async (
  formUrl: string,
  fields: AssistField[],
  options: CliOptions
): Promise<FillResult[]> => {
  const launchOptions = {
    channel: options.browserChannel,
    headless: options.headless
  };

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();

  await page.goto(formUrl, {
    waitUntil: "domcontentloaded",
    timeout: options.timeoutMs
  });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);

  const results = await page.evaluate((assistFields) => {
    type BrowserAssistField = {
      key: string;
      label: string;
      value: string;
      aliases: string[];
    };

    type BrowserFillResult = {
      key: string;
      label: string;
      status: "filled" | "not_found" | "skipped";
      matchedText?: string;
      element?: string;
      reason?: string;
    };

    const normalize = (value: string): string => {
      return value.toLowerCase().replace(/\s+/g, "").replace(/[：:]/g, "");
    };

    const isVisible = (element: Element): boolean => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const isEditable = (element: Element): boolean => {
      if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();
        const unsupportedTypes = [
          "hidden",
          "submit",
          "button",
          "reset",
          "image",
          "file",
          "password",
          "radio",
          "checkbox"
        ];

        return !unsupportedTypes.includes(type) && !element.disabled && !element.readOnly;
      }

      if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return !element.disabled;
      }

      if (element instanceof HTMLElement && element.isContentEditable) {
        return true;
      }

      return false;
    };

    const labelText = (element: Element): string => {
      const parts: string[] = [];
      const id = element.getAttribute("id");

      if (id) {
        document.querySelectorAll(`label[for="${CSS.escape(id)}"]`).forEach((label) => {
          parts.push(label.textContent || "");
        });
      }

      const wrappingLabel = element.closest("label");

      if (wrappingLabel) {
        parts.push(wrappingLabel.textContent || "");
      }

      const parent = element.closest("dd, dt, li, tr, p, div");

      if (parent) {
        parts.push((parent.textContent || "").slice(0, 240));
      }

      ["aria-label", "name", "id", "placeholder", "title", "autocomplete"].forEach((attribute) => {
        parts.push(element.getAttribute(attribute) || "");
      });

      return parts.filter(Boolean).join(" ");
    };

    const elementName = (element: Element): string => {
      const tagName = element.tagName.toLowerCase();
      const type = element instanceof HTMLInputElement ? `[type=${element.type}]` : "";
      const name = element.getAttribute("name") ? `[name=${element.getAttribute("name")}]` : "";
      const id = element.getAttribute("id") ? `#${element.getAttribute("id")}` : "";

      return `${tagName}${type}${id}${name}`;
    };

    const candidateScore = (field: BrowserAssistField, element: Element): number => {
      const sourceText = normalize(labelText(element));
      let score = 0;

      field.aliases.forEach((alias) => {
        const normalizedAlias = normalize(alias);

        if (!normalizedAlias) {
          return;
        }

        if (sourceText === normalizedAlias) {
          score += 14;
        } else if (sourceText.includes(normalizedAlias)) {
          score += 10;
        }
      });

      if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();
        if (field.key === "email" && type === "email") score += 8;
        if (field.key === "tel" && type === "tel") score += 8;
        if (field.key === "url" && type === "url") score += 6;
        if (field.key === "body") score -= 8;
      }

      if (element instanceof HTMLTextAreaElement && field.key === "body") {
        score += 10;
      }

      if (element instanceof HTMLSelectElement && field.key !== "subject") {
        score -= 10;
      }

      return score;
    };

    const setElementValue = (element: Element, field: BrowserAssistField): BrowserFillResult => {
      if (element instanceof HTMLSelectElement) {
        const keywords = ["営業", "協業", "パートナー", "制作", "web", "ホームページ", "その他", "問い合わせ"];
        const option = Array.from(element.options).find((candidate) => {
          if (candidate.disabled || !candidate.value) {
            return false;
          }

          const text = normalize(`${candidate.textContent || ""} ${candidate.value}`);
          return keywords.some((keyword) => text.includes(normalize(keyword)));
        });

        if (!option) {
          return {
            key: field.key,
            label: field.label,
            status: "skipped",
            element: elementName(element),
            matchedText: labelText(element),
            reason: "select has no safe matching option"
          };
        }

        element.value = option.value;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = field.value;
      } else if (element instanceof HTMLElement && element.isContentEditable) {
        element.innerText = field.value;
      } else {
        return {
          key: field.key,
          label: field.label,
          status: "skipped",
          element: elementName(element),
          matchedText: labelText(element),
          reason: "unsupported element"
        };
      }

      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      if (element instanceof HTMLElement) {
        element.style.outline = "3px solid #2563eb";
        element.style.outlineOffset = "2px";
      }

      return {
        key: field.key,
        label: field.label,
        status: "filled",
        element: elementName(element),
        matchedText: labelText(element)
      };
    };

    const elements = Array.from(
      document.querySelectorAll("input, textarea, select, [contenteditable='true']")
    ).filter((element) => isVisible(element) && isEditable(element));
    const used = new Set<Element>();

    return assistFields.map((field): BrowserFillResult => {
      let bestElement: Element | null = null;
      let bestScore = 0;

      elements.forEach((element) => {
        if (used.has(element)) {
          return;
        }

        const score = candidateScore(field, element);

        if (score > bestScore) {
          bestElement = element;
          bestScore = score;
        }
      });

      if (!bestElement || bestScore < 8) {
        return {
          key: field.key,
          label: field.label,
          status: "not_found"
        };
      }

      used.add(bestElement);
      return setElementValue(bestElement, field);
    });
  }, fields);

  console.log("");
  console.log("Fill results:");
  results.forEach((result) => {
    const detail = result.element ? ` (${result.element})` : "";
    const reason = result.reason ? ` - ${result.reason}` : "";
    console.log(`- ${result.label}: ${result.status}${detail}${reason}`);
  });

  console.log("");
  console.log("送信ボタンは押していません。ブラウザ上で内容を確認してください。");

  if (!options.noPause && !options.headless) {
    console.log("確認後、このターミナルでEnterを押すとブラウザを閉じます。");
    await new Promise<void>((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", () => {
        process.stdin.pause();
        resolve();
      });
    });
  }

  await browser.close();

  return results as FillResult[];
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const sheets = await createSheetsClient(config);
  const contentConfig = await readSalesContentConfig(sheets);
  const table = await readSalesManagementTable(sheets);
  const lead = table.leads.find((candidate) => candidate.leadId === options.leadId);

  if (!lead) {
    throw new Error(`Lead not found: ${options.leadId}`);
  }

  validateLead(lead, options.force);

  const message = buildSalesMessage(
    {
      companyName: lead.companyName,
      leadType: lead.leadType,
      industry: lead.industry,
      region: lead.region,
      officialSiteUrl: lead.officialSiteUrl,
      salesAngle: lead.salesAngle,
      recommendedApproach: lead.recommendedApproach,
      salesMessageDraft: lead.salesMessageDraft
    },
    contentConfig
  );
  const fields = buildAssistFields(contentConfig.sender, contentConfig, message.subject, message.body);

  if (options.dryRun) {
    console.log("Dry run: browser will not be opened and sheets will not be updated.");
    printFields(lead, fields, message.templateId);
    return;
  }

  printFields(lead, fields, message.templateId);
  await autofillForm(lead.contactFormUrl, fields, options);
  console.log("");
  console.log(`送信後の記録: npm run forms:mark-sent -- --lead-id ${lead.leadId}`);
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
