import { SHEETS } from "../domain/lead";
import { SheetsClient } from "../google/sheetsClient";

export type SenderInfo = {
  companyName: string;
  name: string;
  nameRoman: string;
  tel: string;
  chatworkId: string;
  email: string;
  url: string;
  address: string;
};

export type FormFieldAliases = {
  companyName: string[];
  name: string[];
  email: string[];
  tel: string[];
  url: string[];
  subject: string[];
  body: string[];
};

export type SalesMessageInput = {
  companyName: string;
  leadType: string;
  industry: string;
  region: string;
  officialSiteUrl: string;
  salesAngle: string;
  recommendedApproach: string;
  salesMessageDraft: string;
};

export type MessageTemplate = {
  templateId: string;
  templateName: string;
  targetLeadTypes: string[];
  recommendedApproaches: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  status: string;
};

export type SalesContentConfig = {
  sender: SenderInfo;
  formFieldAliases: FormFieldAliases;
  templates: MessageTemplate[];
};

export type SalesMessage = {
  subject: string;
  body: string;
  templateId: string;
};

export const CONTACT_SENDER: SenderInfo = {
  companyName: "aaWebCreate",
  name: "阿部 祥士",
  nameRoman: "Abe Akihito",
  tel: "09062121580",
  chatworkId: "abeAawc",
  email: "abe@aawebcreate.com",
  url: "https://aawebcreate.com/",
  address: "埼玉県春日部市"
} as const;

const DEFAULT_FORM_FIELD_ALIASES: FormFieldAliases = {
  companyName: ["会社名", "貴社名", "法人名", "屋号"],
  name: ["お名前", "氏名", "担当者名", "ご担当者名"],
  email: ["メールアドレス", "Email", "E-mail", "mail"],
  tel: ["電話番号", "TEL", "Tel", "tel"],
  url: ["URL", "ホームページ", "Webサイト", "サイトURL"],
  subject: ["件名", "タイトル", "お問い合わせ種別", "題名"],
  body: ["お問い合わせ内容", "内容", "メッセージ", "本文", "詳細"]
};

const OPT_OUT_NOTICE =
  "※今後このようなご連絡が不要な場合は、お手数ですが本メールへの返信にてお知らせください。以後のご連絡を控えます。";

const cell = (row: unknown[], index: number): string => {
  const value = row[index];
  return value === undefined || value === null ? "" : String(value).trim();
};

const splitOptions = (value: string): string[] => {
  return value
    .split(/[\/／、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const readSettingsMap = async (sheets: SheetsClient): Promise<Map<string, string>> => {
  const rows = await sheets.getValues(`'${SHEETS.settings}'!A2:C100`);
  const settings = new Map<string, string>();

  rows.forEach((row) => {
    const key = cell(row, 0);
    const value = cell(row, 1);

    if (key) {
      settings.set(key, value);
    }
  });

  return settings;
};

const setting = (settings: Map<string, string>, key: string, fallback: string): string => {
  return settings.get(key) || fallback;
};

const readSenderInfo = (settings: Map<string, string>): SenderInfo => {
  return {
    companyName: setting(settings, "送信者_会社名", CONTACT_SENDER.companyName),
    name: setting(settings, "送信者_氏名", CONTACT_SENDER.name),
    nameRoman: setting(settings, "送信者_ローマ字", CONTACT_SENDER.nameRoman),
    tel: setting(settings, "送信者_電話番号", CONTACT_SENDER.tel),
    chatworkId: setting(settings, "送信者_チャットワークID", CONTACT_SENDER.chatworkId),
    email: setting(settings, "送信者_メール", CONTACT_SENDER.email),
    url: setting(settings, "送信者_URL", CONTACT_SENDER.url),
    address: setting(settings, "送信者_住所", CONTACT_SENDER.address)
  };
};

const readFormFieldAliases = (settings: Map<string, string>): FormFieldAliases => {
  const readAliases = (key: string, fallback: string[]): string[] => {
    const value = settings.get(key);
    return value ? splitOptions(value) : fallback;
  };

  return {
    companyName: readAliases("フォーム項目_会社名", DEFAULT_FORM_FIELD_ALIASES.companyName),
    name: readAliases("フォーム項目_氏名", DEFAULT_FORM_FIELD_ALIASES.name),
    email: readAliases("フォーム項目_メール", DEFAULT_FORM_FIELD_ALIASES.email),
    tel: readAliases("フォーム項目_電話番号", DEFAULT_FORM_FIELD_ALIASES.tel),
    url: readAliases("フォーム項目_URL", DEFAULT_FORM_FIELD_ALIASES.url),
    subject: readAliases("フォーム項目_件名", DEFAULT_FORM_FIELD_ALIASES.subject),
    body: readAliases("フォーム項目_本文", DEFAULT_FORM_FIELD_ALIASES.body)
  };
};

const readMessageTemplates = async (sheets: SheetsClient): Promise<MessageTemplate[]> => {
  const rows = await sheets.getValues(`'${SHEETS.messageTemplates}'!A2:J100`);

  return rows
    .map((row): MessageTemplate => {
      return {
        templateId: cell(row, 0),
        templateName: cell(row, 1),
        targetLeadTypes: splitOptions(cell(row, 2)),
        recommendedApproaches: splitOptions(cell(row, 3)),
        subjectTemplate: cell(row, 4),
        bodyTemplate: cell(row, 5),
        status: cell(row, 7)
      };
    })
    .filter((template) => template.templateId && template.subjectTemplate && template.bodyTemplate);
};

export const readSalesContentConfig = async (sheets: SheetsClient): Promise<SalesContentConfig> => {
  const settings = await readSettingsMap(sheets);

  return {
    sender: readSenderInfo(settings),
    formFieldAliases: readFormFieldAliases(settings),
    templates: await readMessageTemplates(sheets)
  };
};

const buildSignature = (sender: SenderInfo): string => {
  return [
    sender.companyName,
    `${sender.name} / ${sender.nameRoman}`,
    `TEL : ${sender.tel}`,
    `チャットワークID : ${sender.chatworkId}`,
    `Email : ${sender.email}`,
    `URL : ${sender.url}`
  ].join("\n");
};

export const buildSalesSubject = (leadType: string, recommendedApproach: string): string => {
  if (leadType === "広告代理店" || leadType === "Web制作会社") {
    return "Web制作・コーディングの外部パートナーについて";
  }

  if (recommendedApproach === "LP制作") {
    return "貴社Webサイト・LP改善について";
  }

  if (recommendedApproach === "保守・更新" || recommendedApproach === "WordPress改修") {
    return "貴社Webサイトの更新・改善について";
  }

  return "貴社Webサイトの改善について";
};

const toSentence = (value: string): string => {
  const text = value.trim();

  if (!text) {
    return "";
  }

  return /[。.!！?？]$/.test(text) ? text : `${text}。`;
};

const trimSentenceEnd = (value: string): string => {
  return value.trim().replace(/[。.!！?？]+$/, "");
};

const buildMessageAngle = (salesAngle: string): string => {
  return trimSentenceEnd(salesAngle)
    .replace(/^.+に対し、/, "")
    .replace(/(.+)と連動する(.+)、キャンペーンサイト、Web更新作業を担当する.+$/, "$1と連動した$2・キャンペーンサイトの実装や、日々のWeb更新業務")
    .replace(/を担当できる.+$/, "での支援")
    .replace(/を担当する.+$/, "への対応")
    .replace(/を請け負う.+$/, "への対応")
    .replace(/の業務委託先として提案する$/, "の支援")
    .replace(/として提案しやすい$/, "")
    .replace(/として提案する$/, "")
    .replace(/提案余地がある$/, "お力になれる余地")
    .trim();
};

const splitIndustryParts = (industry: string): string[] => {
  return industry
    .split(/[・、,，／/]/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const compactRepeatedSuffix = (parts: string[], suffix: string): string => {
  if (parts.length <= 1 || !parts.every((part) => part.endsWith(suffix))) {
    return parts.join("・");
  }

  return parts
    .map((part, index) => (index === parts.length - 1 ? part : part.slice(0, -suffix.length)))
    .join("・");
};

const formatIndustryObservation = (industry: string): string => {
  const parts = splitIndustryParts(industry);

  if (parts.length >= 4) {
    const firstGroup = parts.slice(0, 2).join("・");
    const secondGroup = compactRepeatedSuffix(parts.slice(2), "制作");
    return `${firstGroup}から${secondGroup}まで幅広く展開されている事業内容`;
  }

  if (parts.length === 3) {
    return `${parts[0]}から${compactRepeatedSuffix(parts.slice(1), "制作")}まで展開されている事業内容`;
  }

  if (parts.length === 2) {
    return `${parts[0]}や${parts[1]}を展開されている事業内容`;
  }

  return industry ? `${industry}に関する事業内容` : "";
};

const buildClientSpecificObservation = (input: SalesMessageInput): string => {
  const industryText = input.industry
    ? `貴社のHPにて、${formatIndustryObservation(input.industry)}を拝見いたしました。`
    : "貴社のHPを拝見いたしました。";
  const messageAngle = buildMessageAngle(input.salesAngle);

  if (!messageAngle) {
    return industryText;
  }

  return [
    industryText,
    toSentence(
      `特に、${messageAngle}において、私のフロントエンド実装およびWordPress構築の経験が必ずお役に立てると考え、ご連絡いたしました`
    )
  ].join("\n");
};

export const buildSalesBody = (draft: string, sender: SenderInfo = CONTACT_SENDER): string => {
  const parts = [draft.trim()];

  if (!draft.includes("今後このようなご連絡が不要") && !draft.includes("以後のご連絡を控え")) {
    parts.push(OPT_OUT_NOTICE);
  }

  if (!draft.includes(sender.companyName) || !draft.includes(sender.email)) {
    parts.push(buildSignature(sender));
  }

  return parts.join("\n\n");
};

const matchesTemplate = (template: MessageTemplate, input: SalesMessageInput): boolean => {
  if (template.status && template.status !== "使用中") {
    return false;
  }

  const leadTypeMatches =
    template.targetLeadTypes.length === 0 || template.targetLeadTypes.includes(input.leadType);
  const approachMatches =
    template.recommendedApproaches.length === 0 ||
    template.recommendedApproaches.includes(input.recommendedApproach);

  return leadTypeMatches && approachMatches;
};

const pickTemplate = (
  templates: MessageTemplate[],
  input: SalesMessageInput
): MessageTemplate | undefined => {
  return templates.find((template) => matchesTemplate(template, input));
};

const renderTemplate = (
  template: string,
  input: SalesMessageInput,
  sender: SenderInfo
): string => {
  const clientSpecificObservation = buildClientSpecificObservation(input);
  const values = new Map<string, string>([
    ["companyName", input.companyName],
    ["会社名", input.companyName],
    ["企業名", input.companyName],
    ["leadType", input.leadType],
    ["営業先種別", input.leadType],
    ["industry", input.industry],
    ["業種", input.industry],
    ["region", input.region],
    ["地域", input.region],
    ["officialSiteUrl", input.officialSiteUrl],
    ["公式サイトURL", input.officialSiteUrl],
    ["salesAngle", input.salesAngle],
    ["営業の切り口", input.salesAngle],
    ["改善ポイント", input.salesAngle],
    ["clientSpecificObservation", clientSpecificObservation],
    ["本文向け一言", clientSpecificObservation],
    ["具体的一言", clientSpecificObservation],
    ["recommendedApproach", input.recommendedApproach],
    ["推奨アプローチ", input.recommendedApproach],
    ["senderCompanyName", sender.companyName],
    ["送信者_会社名", sender.companyName],
    ["送信者会社名", sender.companyName],
    ["senderName", sender.name],
    ["送信者_氏名", sender.name],
    ["送信者氏名", sender.name],
    ["senderNameRoman", sender.nameRoman],
    ["送信者_ローマ字", sender.nameRoman],
    ["senderTel", sender.tel],
    ["送信者_電話番号", sender.tel],
    ["senderEmail", sender.email],
    ["送信者_メール", sender.email],
    ["senderUrl", sender.url],
    ["送信者_URL", sender.url],
    ["senderAddress", sender.address],
    ["送信者_住所", sender.address],
    ["senderChatworkId", sender.chatworkId],
    ["送信者_チャットワークID", sender.chatworkId]
  ]);

  return template.replace(/\{([^{}]+)\}/g, (match, key: string) => {
    return values.get(key.trim()) ?? match;
  });
};

export const buildSalesMessage = (
  input: SalesMessageInput,
  config?: SalesContentConfig
): SalesMessage => {
  const sender = config?.sender ?? CONTACT_SENDER;
  const template = config ? pickTemplate(config.templates, input) : undefined;

  if (template) {
    return {
      subject: renderTemplate(template.subjectTemplate, input, sender),
      body: buildSalesBody(renderTemplate(template.bodyTemplate, input, sender), sender),
      templateId: template.templateId
    };
  }

  return {
    subject: buildSalesSubject(input.leadType, input.recommendedApproach),
    body: buildSalesBody(input.salesMessageDraft, sender),
    templateId: "fallback"
  };
};
