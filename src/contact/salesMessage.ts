import { SHEETS } from "../domain/lead";
import { SheetsClient } from "../google/sheetsClient";

export type SenderInfo = {
  companyName: string;
  companyNameKana: string;
  name: string;
  nameKana: string;
  nameHiragana: string;
  department: string;
  businessDescription: string;
  nameRoman: string;
  age: string;
  tel: string;
  chatworkId: string;
  email: string;
  url: string;
  portfolioUrl: string;
  address: string;
  formAddress: string;
  postalCode: string;
  prefecture: string;
  city: string;
  streetAddress: string;
  // フォームの「得意としている業務」などの欄に入れる文
  specialty: string;
  // 署名の1行目に、会社名のあとに続ける紹介文
  signatureTagline: string;
  // 配信停止の案内文（本文に無いときに自動で付ける）
  optOutNotice: string;
};

export type FormFieldAliases = {
  companyName: string[];
  name: string[];
  nameKana: string[];
  nameHiragana: string[];
  age: string[];
  department: string[];
  email: string[];
  tel: string[];
  url: string[];
  portfolioUrl: string[];
  address: string[];
  postalCode: string[];
  prefecture: string[];
  city: string[];
  streetAddress: string[];
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
  // 連絡手段。再送文面をメール用・フォーム用で切り替えるために使う
  channel?: "メール" | "フォーム";
  // 前回送信した日（YYYY-MM-DD）。入っていれば2回目以降の送信として「再送」用の文面を選ぶ
  previousSentAt?: string;
};

export type TemplatePurpose = "初回" | "再送";

export type MessageTemplate = {
  templateId: string;
  templateName: string;
  targetLeadTypes: string[];
  recommendedApproaches: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  status: string;
  purpose: TemplatePurpose;
  // 空欄はメール・フォーム共通
  channel: "メール" | "フォーム" | "";
};

export type SalesContentConfig = {
  sender: SenderInfo;
  formFieldAliases: FormFieldAliases;
  templates: MessageTemplate[];
};

export type SalesMessage = {
  subject: string;
  body: string;
  autoInsertPreview: string;
  templateId: string;
};

export const CONTACT_SENDER: SenderInfo = {
  companyName: "aaWebCreate",
  companyNameKana: "エーエーウェブクリエイト",
  name: "阿部 祥士",
  nameKana: "アベ アキヒト",
  nameHiragana: "あべ あきひと",
  department: "代表",
  businessDescription: "Webサイト制作・Webアプリ開発・保守運用",
  nameRoman: "Abe Akihito",
  age: "36",
  tel: "09062121580",
  chatworkId: "abeAawc",
  email: "abe@aawebcreate.com",
  url: "https://aawebcreate.com/",
  portfolioUrl: "https://aawebcreate.com/profile/",
  address: "埼玉県春日部市",
  formAddress: "埼玉県春日部市西金野井1074-10",
  postalCode: "344-0112",
  prefecture: "埼玉県",
  city: "春日部市",
  streetAddress: "西金野井1074-10",
  specialty:
    "WordPress・Shopifyのサイト構築・改修、HTML/CSS/JavaScriptによるフロントエンド実装、保守運用。Next.js / TypeScriptでのWebアプリ開発（Googleカレンダー連携の予約システム、生成AIを組み込んだ業務ツールなど）にも対応しています。",
  signatureTagline: "春日部市でフリーランスのWeb制作を行っています。",
  optOutNotice:
    "※今後このようなご連絡が不要な場合は、お手数ですが本メールへの返信にてお知らせください。以後のご連絡を控えます。"
} as const;

const DEFAULT_FORM_FIELD_ALIASES: FormFieldAliases = {
  companyName: ["会社名", "貴社名", "法人名", "屋号"],
  name: ["お名前", "氏名", "担当者名", "ご担当者名"],
  nameKana: ["フリガナ", "ふりがな", "カナ", "氏名カナ", "氏名かな", "お名前カナ", "ご担当者名フリガナ"],
  nameHiragana: ["ふりがな", "氏名かな", "お名前かな", "ご担当者名ふりがな"],
  age: ["年齢", "歳", "age"],
  department: ["部署", "部署名", "所属部署", "所属部署名", "部門", "部門名", "department", "division", "section"],
  email: ["メールアドレス", "Email", "E-mail", "mail"],
  tel: ["電話番号", "TEL", "Tel", "tel"],
  url: ["URL", "ホームページ", "Webサイト", "サイトURL"],
  portfolioUrl: ["実績URL", "実績", "ポートフォリオ", "作品", "制作実績", "portfolio"],
  address: ["住所", "所在地", "ご住所", "住所地", "address", "location"],
  postalCode: ["郵便番号", "郵便", "〒", "zip", "postal"],
  prefecture: ["都道府県", "都道府県名", "prefecture"],
  city: ["市区町村", "市町村", "区市町村", "市区郡町村", "city", "municipality"],
  streetAddress: ["以降の住所", "以降住所", "番地", "町名番地", "丁目番地", "street", "address2"],
  subject: ["件名", "タイトル", "お問い合わせ種別", "題名"],
  body: ["お問い合わせ内容", "内容", "メッセージ", "本文", "詳細"]
};

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
    companyNameKana: setting(settings, "送信者_会社名カナ", CONTACT_SENDER.companyNameKana),
    name: setting(settings, "送信者_氏名", CONTACT_SENDER.name),
    nameKana: settings.get("送信者_氏名カナ") || settings.get("送信者_フリガナ") || CONTACT_SENDER.nameKana,
    nameHiragana: setting(settings, "送信者_氏名ひらがな", CONTACT_SENDER.nameHiragana),
    department: setting(settings, "送信者_部署名", CONTACT_SENDER.department),
    businessDescription: setting(settings, "送信者_事業内容", CONTACT_SENDER.businessDescription),
    nameRoman: setting(settings, "送信者_ローマ字", CONTACT_SENDER.nameRoman),
    age: setting(settings, "送信者_年齢", CONTACT_SENDER.age),
    tel: setting(settings, "送信者_電話番号", CONTACT_SENDER.tel),
    chatworkId: setting(settings, "送信者_チャットワークID", CONTACT_SENDER.chatworkId),
    email: setting(settings, "送信者_メール", CONTACT_SENDER.email),
    url: setting(settings, "送信者_URL", CONTACT_SENDER.url),
    portfolioUrl: setting(settings, "送信者_実績URL", CONTACT_SENDER.portfolioUrl),
    address: setting(settings, "送信者_住所", CONTACT_SENDER.address),
    formAddress: setting(settings, "送信者_フォーム住所", CONTACT_SENDER.formAddress),
    postalCode: setting(settings, "送信者_郵便番号", CONTACT_SENDER.postalCode),
    prefecture: setting(settings, "送信者_都道府県", CONTACT_SENDER.prefecture),
    city: setting(settings, "送信者_市区町村", CONTACT_SENDER.city),
    streetAddress: setting(settings, "送信者_以降の住所", CONTACT_SENDER.streetAddress),
    specialty: setting(settings, "送信者_得意な業務", CONTACT_SENDER.specialty),
    signatureTagline: setting(settings, "署名_紹介文", CONTACT_SENDER.signatureTagline),
    optOutNotice: setting(settings, "配信停止の案内文", CONTACT_SENDER.optOutNotice)
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
    nameKana: readAliases("フォーム項目_氏名カナ", DEFAULT_FORM_FIELD_ALIASES.nameKana),
    nameHiragana: readAliases("フォーム項目_氏名ひらがな", DEFAULT_FORM_FIELD_ALIASES.nameHiragana),
    age: readAliases("フォーム項目_年齢", DEFAULT_FORM_FIELD_ALIASES.age),
    department: readAliases("フォーム項目_部署名", DEFAULT_FORM_FIELD_ALIASES.department),
    email: readAliases("フォーム項目_メール", DEFAULT_FORM_FIELD_ALIASES.email),
    tel: readAliases("フォーム項目_電話番号", DEFAULT_FORM_FIELD_ALIASES.tel),
    url: readAliases("フォーム項目_URL", DEFAULT_FORM_FIELD_ALIASES.url),
    portfolioUrl: readAliases("フォーム項目_実績URL", DEFAULT_FORM_FIELD_ALIASES.portfolioUrl),
    address: readAliases("フォーム項目_住所", DEFAULT_FORM_FIELD_ALIASES.address),
    postalCode: readAliases("フォーム項目_郵便番号", DEFAULT_FORM_FIELD_ALIASES.postalCode),
    prefecture: readAliases("フォーム項目_都道府県", DEFAULT_FORM_FIELD_ALIASES.prefecture),
    city: readAliases("フォーム項目_市区町村", DEFAULT_FORM_FIELD_ALIASES.city),
    streetAddress: readAliases("フォーム項目_以降の住所", DEFAULT_FORM_FIELD_ALIASES.streetAddress),
    subject: readAliases("フォーム項目_件名", DEFAULT_FORM_FIELD_ALIASES.subject),
    body: readAliases("フォーム項目_本文", DEFAULT_FORM_FIELD_ALIASES.body)
  };
};

const readMessageTemplates = async (sheets: SheetsClient): Promise<MessageTemplate[]> => {
  const rows = await sheets.getValues(`'${SHEETS.messageTemplates}'!A2:L100`);

  return rows
    .map((row): MessageTemplate => {
      const channel = cell(row, 11);

      return {
        templateId: cell(row, 0),
        templateName: cell(row, 1),
        targetLeadTypes: splitOptions(cell(row, 2)),
        recommendedApproaches: splitOptions(cell(row, 3)),
        subjectTemplate: cell(row, 4),
        bodyTemplate: cell(row, 5),
        status: cell(row, 7),
        purpose: cell(row, 10) === "再送" ? "再送" : "初回",
        channel: channel === "メール" || channel === "フォーム" ? channel : ""
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

const SIGNATURE_RULE = "◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇◆◇";

// 特定電子メール法により、送信者の住所を署名に必ず含める。
const buildSignature = (sender: SenderInfo): string => {
  const postalCode = sender.postalCode ? `〒${sender.postalCode} ` : "";

  return [
    SIGNATURE_RULE,
    `${sender.companyName}${sender.signatureTagline ? ` | ${sender.signatureTagline}` : ""}`,
    `${sender.name} / ${sender.nameRoman}`,
    `住所 : ${postalCode}${sender.formAddress || sender.address}`,
    `TEL : ${sender.tel}`,
    `チャットワークID : ${sender.chatworkId}`,
    `Email : ${sender.email}`,
    `URL : ${sender.url}`,
    SIGNATURE_RULE
  ].join("\n");
};

const WEB_PARTNER_FALLBACK_TEMPLATE: MessageTemplate = {
  templateId: "fallback-web-partner-template",
  templateName: "標準テンプレート: 制作会社・広告代理店向け",
  targetLeadTypes: ["広告代理店", "Web制作会社"],
  recommendedApproaches: [],
  subjectTemplate: "{会社名}｜Web制作・コーディング外部パートナーのご提案（aaWebCreate 阿部）",
  bodyTemplate: `{会社名}
ご担当者様

突然のご連絡失礼いたします。
埼玉県春日部市でフリーランスのWebエンジニアをしております、aaWebCreateの阿部と申します。

{本文向け一言}

Web業界12年（独立9年）、WordPress・Shopifyの実装を中心に、サイト改修・保守まで対応しております。
またNext.js / TypeScriptでのWebアプリ開発も行っており、Googleカレンダー連携の予約システムや、
生成AIを組み込んだ業務ツールなども制作しております。

大手広告代理店（電通・博報堂）案件を含め、制作会社様からの二次請け案件を多数担当しており、
NDA締結・フルリモートでの対応が可能です。

▼ 経歴・実績はこちらにまとめております。
https://aawebcreate.com/profile/

リソース不足や技術的な課題などでお困りの際は、スポットのご依頼からでもお気軽にご相談いただけますと幸いです。
何卒よろしくお願い申し上げます。

※今後このようなご連絡が不要な場合は、お手数ですが本メールへの返信にてお知らせください。以後のご連絡を控えます。

{署名}`,
  status: "使用中",
  purpose: "初回",
  channel: ""
};

const DIRECT_CLIENT_FALLBACK_TEMPLATE: MessageTemplate = {
  templateId: "fallback-direct-client-template",
  templateName: "標準テンプレート: 直クライアント向け",
  targetLeadTypes: ["直クライアント"],
  recommendedApproaches: [],
  subjectTemplate: "{会社名}｜Webサイト改善のご提案（aaWebCreate 阿部）",
  bodyTemplate: `{会社名} ご担当者様

突然のご連絡失礼いたします。
{送信者_住所}にて「{送信者_会社名}」としてWeb制作を行っております、{送信者_氏名}と申します。

{本文向け一言}

現在はWordPressを中心としたWebサイト制作、フロントエンド実装、Shopify構築、既存サイト改修などを行っております。
実績・対応領域はこちらにまとめております。
https://aawebcreate.com/profile/

もし今後、Webサイトの改善や更新をご検討される機会がございましたら、選択肢の一つとしてお声がけいただけますと幸いです。
何卒よろしくお願いいたします。`,
  status: "使用中",
  purpose: "初回",
  channel: ""
};

export const FIRST_PLACEHOLDERS = [
  "{会社名}",
  "{本文向け一言}",
  "{営業の切り口}",
  "{送信者_氏名}",
  "{送信者_会社名}",
  "{送信者_住所}",
  "{送信者_URL}",
  "{署名}"
] as const;

export const FOLLOW_UP_PLACEHOLDERS = [
  "{会社名}",
  "{前回送信月}",
  "{前回送信日}",
  "{送信者_氏名}",
  "{送信者_会社名}",
  "{送信者_URL}",
  "{署名}"
] as const;

const FOLLOW_UP_PARTNER_SUBJECT = "【再ご連絡】Web・システム開発の外部パートナーのご提案｜aaWebCreate 阿部";
const FOLLOW_UP_DIRECT_SUBJECT = "【再ご連絡】Webサイト改善のご提案｜aaWebCreate 阿部";

export const FOLLOW_UP_DEFAULTS = {
  partnerEmail: {
    subject: FOLLOW_UP_PARTNER_SUBJECT,
    body: `{会社名}
ご担当者様

埼玉県春日部市で、フリーランスとしてWeb制作・システム開発を行っております、aaWebCreateの阿部です。
{前回送信月}に、外部制作パートナーのご提案で、ご連絡いたしました。お忙しいところ恐れ入ります。改めて、簡単にご連絡いたします。

制作会社様の案件で、リソースが足りない時や、特定の技術（Next.js / Shopify / WordPress改修など）の知見が必要な時に、スポットでもお力になれます。
最近は、予約システムの開発や、生成AIを組み込んだ業務ツールの制作も、承っております。

▼ 経歴・実績
https://aawebcreate.com/profile/

▼ オンライン面談のご予約
https://booking.aawebcreate.com/

現在、必要なければ、このままお読み流しいただいて構いません。

※今後このようなご連絡が不要な場合は、本メールへの返信でお知らせください。以後のご連絡を控えます。`
  },
  partnerForm: {
    subject: FOLLOW_UP_PARTNER_SUBJECT,
    body: `フリーランスでWeb制作・システム開発を行っております、aaWebCreateの阿部です。{前回送信月}に、外部制作パートナーのご提案で、ご連絡いたしました。改めて、簡単にご連絡いたします。

Web業界12年、WordPress・Shopifyの実装から、Next.js / TypeScriptでのWebアプリ開発まで、制作会社様の案件で、スポットでもお力になれます。
経歴・実績は、こちらです。
https://aawebcreate.com/profile/

現在、必要なければ、このままお読み流しください。今後のご連絡が不要な場合は、お知らせいただければ、以後のご連絡を控えます。`
  },
  directEmail: {
    subject: FOLLOW_UP_DIRECT_SUBJECT,
    body: `{会社名}
ご担当者様

埼玉県春日部市で、フリーランスとしてWeb制作・システム開発を行っております、aaWebCreateの阿部です。
{前回送信月}に、Webサイトの改善について、ご連絡いたしました。お忙しいところ恐れ入ります。改めて、簡単にご連絡いたします。

WordPressを中心としたWebサイト制作、Shopify構築、既存サイトの改修や保守などを行っております。
実績・対応領域は、こちらにまとめております。
https://aawebcreate.com/profile/

現在、必要なければ、このままお読み流しください。

※今後このようなご連絡が不要な場合は、本メールへの返信でお知らせください。以後のご連絡を控えます。`
  },
  directForm: {
    subject: FOLLOW_UP_DIRECT_SUBJECT,
    body: `フリーランスでWeb制作・システム開発を行っております、aaWebCreateの阿部です。{前回送信月}に、Webサイトの改善について、ご連絡いたしました。改めて、簡単にご連絡いたします。

WordPressを中心としたWebサイト制作、Shopify構築、既存サイトの改修や保守などを行っております。
実績・対応領域は、こちらです。
https://aawebcreate.com/profile/

現在、必要なければ、このままお読み流しください。今後のご連絡が不要な場合は、お知らせいただければ、以後のご連絡を控えます。`
  }
} as const;

const followUpFallbackTemplate = (input: SalesMessageInput): MessageTemplate => {
  const isDirect = input.leadType === "直クライアント";
  const isForm = input.channel === "フォーム";
  const preset = isDirect
    ? isForm
      ? FOLLOW_UP_DEFAULTS.directForm
      : FOLLOW_UP_DEFAULTS.directEmail
    : isForm
      ? FOLLOW_UP_DEFAULTS.partnerForm
      : FOLLOW_UP_DEFAULTS.partnerEmail;

  return {
    templateId: `fallback-follow-up-${isDirect ? "direct" : "partner"}-${isForm ? "form" : "email"}`,
    templateName: "標準テンプレート: 再送",
    targetLeadTypes: [],
    recommendedApproaches: [],
    subjectTemplate: preset.subject,
    bodyTemplate: preset.body,
    status: "使用中",
    purpose: "再送",
    channel: isForm ? "フォーム" : "メール"
  };
};

// 前回送信日から「3月」「2025年11月」のような表記を作る。1年以上前なら年も付ける。
export const formatPreviousSentMonth = (previousSentAt: string, now: Date = new Date()): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(previousSentAt);

  if (!match) {
    return "先日";
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const currentYear = Number(
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric" }).format(now)
  );

  return year === currentYear ? `${month}月` : `${year}年${month}月`;
};

const formatPreviousSentDate = (previousSentAt: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(previousSentAt);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : "";
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

const observationClosing = (leadType: string): string => {
  return leadType === "直クライアント"
    ? "Webサイトの改善・運用でお力になれればと思いご連絡いたしました。"
    : "外部制作パートナーとしてお力になれればと思いご連絡いたしました。";
};

const buildClientSpecificObservation = (input: SalesMessageInput): string => {
  return `貴社のHPを拝見し、${observationClosing(input.leadType)}`;
};

export const buildSalesBody = (draft: string, sender: SenderInfo = CONTACT_SENDER): string => {
  const parts = [draft.trim()];

  if (!draft.includes("今後このようなご連絡が不要") && !draft.includes("以後のご連絡を控え")) {
    parts.push(sender.optOutNotice);
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

  if (template.purpose === "再送") {
    return false;
  }

  const leadTypeMatches =
    template.targetLeadTypes.length === 0 || template.targetLeadTypes.includes(input.leadType);
  const approachMatches =
    template.recommendedApproaches.length === 0 ||
    template.recommendedApproaches.includes(input.recommendedApproach);

  return leadTypeMatches && approachMatches;
};

const matchesLeadType = (template: MessageTemplate, input: SalesMessageInput): boolean => {
  if (template.status && template.status !== "使用中") {
    return false;
  }

  if (template.purpose === "再送") {
    return false;
  }

  return template.targetLeadTypes.length === 0 || template.targetLeadTypes.includes(input.leadType);
};

const pickTemplate = (
  templates: MessageTemplate[],
  input: SalesMessageInput
): MessageTemplate | undefined => {
  return (
    templates.find((template) => matchesTemplate(template, input)) ??
    templates.find((template) => matchesLeadType(template, input))
  );
};

// 再送用: 使用中の「再送」行から、営業先種別が合い、連絡手段が合うものを選ぶ（連絡手段が一致する行を優先）。
const pickFollowUpTemplate = (
  templates: MessageTemplate[],
  input: SalesMessageInput
): MessageTemplate | undefined => {
  const candidates = templates.filter((template) => {
    if (template.purpose !== "再送" || (template.status && template.status !== "使用中")) {
      return false;
    }

    const leadTypeMatches =
      template.targetLeadTypes.length === 0 || template.targetLeadTypes.includes(input.leadType);
    const channelMatches = !template.channel || !input.channel || template.channel === input.channel;

    return leadTypeMatches && channelMatches;
  });

  const exactChannel = candidates.filter((template) => template.channel && template.channel === input.channel);
  const exactLeadType = (list: MessageTemplate[]): MessageTemplate | undefined =>
    list.find((template) => template.targetLeadTypes.includes(input.leadType)) ?? list[0];

  return exactLeadType(exactChannel) ?? exactLeadType(candidates);
};

const pickFallbackTemplate = (input: SalesMessageInput): MessageTemplate | undefined => {
  if (input.leadType === "広告代理店" || input.leadType === "Web制作会社") {
    return WEB_PARTNER_FALLBACK_TEMPLATE;
  }

  if (input.leadType === "直クライアント") {
    return DIRECT_CLIENT_FALLBACK_TEMPLATE;
  }

  return undefined;
};

// 「株式会社monomode（モノモード）」のような読み仮名・英字表記の括弧書きは宛名として不自然なため、
// メール・フォームに差し込むときだけ外す。（株）や（旧〇〇）など漢字を含む括弧書きは残す。
export const toMailCompanyName = (companyName: string): string => {
  const stripped = companyName
    .replace(/\s*[（(][\s\u3041-\u309F\u30A0-\u30FFー・A-Za-z0-9.,&'\-]+[）)]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return stripped || companyName.trim();
};

const renderTemplate = (
  template: string,
  input: SalesMessageInput,
  sender: SenderInfo
): string => {
  const clientSpecificObservation = buildClientSpecificObservation(input);
  const companyName = toMailCompanyName(input.companyName);
  const signature = buildSignature(sender);
  const values = new Map<string, string>([
    ["companyName", companyName],
    ["会社名", companyName],
    ["企業名", companyName],
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
    ["signature", signature],
    ["署名", signature],
    ["前回送信月", input.previousSentAt ? formatPreviousSentMonth(input.previousSentAt) : "先日"],
    ["前回送信日", input.previousSentAt ? formatPreviousSentDate(input.previousSentAt) : "先日"],
    ["recommendedApproach", input.recommendedApproach],
    ["推奨アプローチ", input.recommendedApproach],
    ["senderCompanyName", sender.companyName],
    ["送信者_会社名", sender.companyName],
    ["送信者会社名", sender.companyName],
    ["senderName", sender.name],
    ["送信者_氏名", sender.name],
    ["送信者氏名", sender.name],
    ["senderNameKana", sender.nameKana],
    ["送信者_氏名カナ", sender.nameKana],
    ["送信者_フリガナ", sender.nameKana],
    ["senderNameHiragana", sender.nameHiragana],
    ["送信者_氏名ひらがな", sender.nameHiragana],
    ["senderDepartment", sender.department],
    ["送信者_部署名", sender.department],
    ["senderNameRoman", sender.nameRoman],
    ["送信者_ローマ字", sender.nameRoman],
    ["senderAge", sender.age],
    ["送信者_年齢", sender.age],
    ["senderTel", sender.tel],
    ["送信者_電話番号", sender.tel],
    ["senderEmail", sender.email],
    ["送信者_メール", sender.email],
    ["senderUrl", sender.url],
    ["送信者_URL", sender.url],
    ["senderAddress", sender.address],
    ["送信者_住所", sender.address],
    ["senderFormAddress", sender.formAddress],
    ["送信者_フォーム住所", sender.formAddress],
    ["senderPostalCode", sender.postalCode],
    ["送信者_郵便番号", sender.postalCode],
    ["senderPrefecture", sender.prefecture],
    ["送信者_都道府県", sender.prefecture],
    ["senderCity", sender.city],
    ["送信者_市区町村", sender.city],
    ["senderStreetAddress", sender.streetAddress],
    ["送信者_以降の住所", sender.streetAddress],
    ["senderSpecialty", sender.specialty],
    ["送信者_得意な業務", sender.specialty],
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
  const isFollowUp = Boolean(input.previousSentAt);
  const template = isFollowUp
    ? (config ? pickFollowUpTemplate(config.templates, input) : undefined) ?? followUpFallbackTemplate(input)
    : config
      ? pickTemplate(config.templates, input)
      : undefined;
  const fallbackTemplate = template ?? pickFallbackTemplate(input);
  const autoInsertPreview = buildClientSpecificObservation(input);

  if (fallbackTemplate) {
    return {
      subject: renderTemplate(fallbackTemplate.subjectTemplate, input, sender),
      body: buildSalesBody(renderTemplate(fallbackTemplate.bodyTemplate, input, sender), sender),
      autoInsertPreview,
      templateId: fallbackTemplate.templateId
    };
  }

  return {
    subject: buildSalesSubject(input.leadType, input.recommendedApproach),
    body: buildSalesBody(input.salesMessageDraft, sender),
    autoInsertPreview,
    templateId: "fallback"
  };
};

// 設定画面のプレビュー用: 入力中の件名・本文で、文面がどう表示されるかを作る（サンプルの会社名・前回送信月で差し込む）
export const previewTemplate = (
  draft: { subject: string; body: string; channel: "メール" | "フォーム" | ""; leadType: string; purpose: TemplatePurpose },
  config: SalesContentConfig
): { subject: string; body: string } => {
  const previewTemplate: MessageTemplate = {
    templateId: "preview",
    templateName: "preview",
    targetLeadTypes: [],
    recommendedApproaches: [],
    subjectTemplate: draft.subject,
    bodyTemplate: draft.body,
    status: "使用中",
    purpose: draft.purpose,
    channel: draft.channel
  };
  const message = buildSalesMessage(
    {
      companyName: "株式会社サンプル",
      leadType: draft.leadType,
      industry: "Web制作",
      region: "東京都",
      officialSiteUrl: "https://example.com/",
      salesAngle: "サイトの更新を外部に任せる余地がある",
      recommendedApproach: "",
      salesMessageDraft: "",
      channel: draft.channel || "メール",
      previousSentAt: draft.purpose === "再送" ? previousMonthSample() : undefined
    },
    { ...config, templates: [previewTemplate] }
  );

  return { subject: message.subject, body: message.body };
};

const previousMonthSample = (): string => {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - 3);
  return date.toISOString().slice(0, 10);
};
