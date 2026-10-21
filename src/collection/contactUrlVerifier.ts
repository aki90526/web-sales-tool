import { LeadCandidate } from "../openai/leadCandidateCollector";
import { BROWSER_FETCH_OPTIONS, decodeHtmlEntities, fetchPage, fetchText, htmlToText } from "./companyNameVerifier";

export type ContactUrlVerificationResult = {
  candidate: LeadCandidate;
  correction?: {
    from: string;
    to: string;
    sourceUrl: string;
    reason: string;
  };
};

type LinkCandidate = {
  url: string;
  text: string;
};

const normalizeUrlKey = (value: string): string => {
  return value.trim().replace(/\/$/, "");
};

const safeUrl = (value: string, baseUrl?: string): URL | null => {
  try {
    return baseUrl ? new URL(value, baseUrl) : new URL(value);
  } catch {
    return null;
  }
};

const extractHref = (attributes: string): string => {
  const hrefMatch = attributes.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return decodeHtmlEntities((hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim());
};

const extractLinks = (html: string, sourceUrl: string): LinkCandidate[] => {
  const source = new URL(sourceUrl);
  const links: LinkCandidate[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = extractHref(match[1]);

    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) {
      continue;
    }

    const parsed = safeUrl(href, sourceUrl);

    if (!parsed || parsed.origin !== source.origin) {
      continue;
    }

    const text = htmlToText(match[2]).trim();

    links.push({
      url: parsed.toString(),
      text
    });
  }

  return links;
};

const pageAppearsToContainForm = (html: string): boolean => {
  return /<form\b/i.test(html) && /<(input|textarea|select)\b/i.test(html);
};

// お知らせ・ブログ・コラムなどの記事ページのパス（問い合わせフォームではない）
export const ARTICLE_PATH_PATTERN = /\/(news|blog|column|columns|topics?|press|release|releases|archives?|article|articles|post|posts|info|information|story|stories|case|works?)\/[^/]+/i;

const isProductionOrAgencyLead = (leadType: string): boolean => {
  return leadType === "Web制作会社" || leadType === "広告代理店";
};

const scoreContactLink = (link: LinkCandidate, sourceUrl: string, leadType: string): number => {
  const source = new URL(sourceUrl);
  const target = new URL(link.url);
  const sourcePath = source.pathname.replace(/\/$/, "");
  const targetPath = target.pathname.replace(/\/$/, "");
  const haystack = `${link.text} ${target.pathname} ${target.search}`.toLowerCase();
  let score = 0;

  if (/(お問い合わせ|問合せ|お問合せ|contact|inquiry|フォーム|form)/i.test(haystack)) {
    score += 35;
  }

  if (/(相談|見積|依頼|資料請求)/.test(haystack)) {
    score += 8;
  }

  if (isProductionOrAgencyLead(leadType)) {
    if (/(制作パートナー|ビジネスパートナー|パートナー|協業|提携|業務委託|外注|営業)/.test(haystack)) {
      score += 55;
    }
  } else if (/(制作パートナー|ビジネスパートナー|パートナー|協業|提携|業務委託|外注)/.test(haystack)) {
    score -= 10;
  }

  if (/(採用|求人|新卒|中途|recruit|career|entry|job)/i.test(haystack)) {
    score -= /パートナー|協業|提携|業務委託|外注/.test(haystack) ? 10 : 35;
  }

  if (sourcePath && targetPath.startsWith(`${sourcePath}/`) && targetPath.length > sourcePath.length) {
    score += 15;
  }

  // サイト直下の標準的な問い合わせページ（/contact/ など）
  if (/^\/(contact|contact-us|contactus|inquiry|toiawase|otoiawase|form)(\/|$)/i.test(targetPath)) {
    score += 30;
  }

  if (/(\/form|form\d+|\/inquiry|\/contact\/.+)/i.test(target.pathname)) {
    score += 12;
  }

  return score;
};

const findBestContactLink = (
  html: string,
  sourceUrl: string,
  leadType: string,
  currentUrl: string
): { link: LinkCandidate; score: number } | null => {
  const currentKey = normalizeUrlKey(currentUrl);
  const links = extractLinks(html, sourceUrl)
    .filter((link) => normalizeUrlKey(link.url) !== currentKey)
    .map((link) => ({
      link,
      score: scoreContactLink(link, sourceUrl, leadType)
    }))
    .sort((a, b) => b.score - a.score);

  return links[0] ?? null;
};

const candidateSourceUrls = (candidate: LeadCandidate): string[] => {
  const urls = [candidate.contactUrl, candidate.officialSiteUrl].filter(Boolean);
  return Array.from(
    new Set(
      urls
        .map((url) => safeUrl(url))
        .filter((url): url is URL => url !== null)
        .map((url) => url.toString())
    )
  );
};

// テーマのデモ・サンプルページ（本物の問い合わせ窓口ではない）のパス
export const DEMO_PAGE_PATH_PATTERN = /\/(elements?|demo|demos|sample|samples|template|templates|example|examples|dummy|preview)(\/|$)/i;

const normalizedPath = (url: URL): string => url.pathname.replace(/\/+$/, "") || "/";
const normalizedHost = (url: URL): string => url.hostname.toLowerCase().replace(/^www\./, "");

export const isRedirectedElsewhere = (originalUrl: string, finalUrl: string): boolean => {
  try {
    const original = new URL(originalUrl);
    const final = new URL(finalUrl);

    return normalizedHost(original) !== normalizedHost(final) || normalizedPath(original) !== normalizedPath(final);
  } catch {
    return false;
  }
};

const EXTERNAL_FORM_PROVIDERS =
  /(bownow|formrun|form\.run|hubspot|hsforms|zfrmz|zohopublic|typeform|forms\.gle|docs\.google\.com\/forms|kintone|formzu|shanon|formoid|fm\.mydomain|cloudsign)/i;

export type FormPresenceResult = {
  warning?: string;
};

// フォームURLのページに <form> があるかを確認する。無ければ警告を返す（JavaScriptで後から表示されるフォームの可能性もあるため、除外はしない）
export const checkFormPresence = async (contactUrl: string): Promise<FormPresenceResult> => {
  if (!contactUrl) {
    return {};
  }

  let html: string;

  try {
    html = (await fetchPage(contactUrl, 0, BROWSER_FETCH_OPTIONS)).text;
  } catch {
    return {};
  }

  if (pageAppearsToContainForm(html)) {
    return {};
  }

  // リンク（<a>）ではなく、埋め込み（iframe・スクリプト）に外部フォームサービスがある場合だけ「埋め込み」とみなす
  const embedSources = [
    ...Array.from(html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)).map((match) => match[1]),
    ...Array.from(html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)).map((match) => match[1])
  ];

  if (embedSources.some((source) => EXTERNAL_FORM_PROVIDERS.test(source))) {
    return { warning: "フォームが外部サービスの埋め込みの可能性があります（自動入力が効かない場合があります）" };
  }

  return {
    warning: "フォームURLのページに入力フォーム(<form>)が見当たりません。フォームのURLが正しいか確認してください（JavaScriptで表示されるフォームの可能性もあります）"
  };
};

export type ContactTargetResult = {
  candidate: LeadCandidate;
  note?: string;
};

// 問い合わせフォームURLが別ページへ転送される場合に、転送先が本物のフォームかを確認する
export const verifyContactUrlTarget = async (candidate: LeadCandidate): Promise<ContactTargetResult> => {
  if (!candidate.contactUrl) {
    return { candidate };
  }

  let page: { text: string; finalUrl: string };

  try {
    page = await fetchPage(candidate.contactUrl, 0, BROWSER_FETCH_OPTIONS);
  } catch (error: unknown) {
    // 404/410 は存在しないURL（AIが推測で作ったURLなど）なので除外する。それ以外の失敗（ブロック等）は判断しない
    if (!(error instanceof Error) || !/Unexpected status (404|410)/.test(error.message)) {
      return { candidate };
    }

    const reason = "フォームURLが存在しない(404)ため除外";

    return {
      candidate: {
        ...candidate,
        contactUrl: "",
        memo: [candidate.memo, `連絡先除外: ${reason} (${candidate.contactUrl})`].filter(Boolean).join("\n"),
        status: !candidate.email && candidate.status === "送信待ち" ? "見送り" : candidate.status
      },
      note: `除外: ${reason}`
    };
  }

  // 記事ページ（お知らせ・ブログなど）で、入力フォームも無い場合は、問い合わせ先として不適切なため除外する
  if (ARTICLE_PATH_PATTERN.test(new URL(page.finalUrl).pathname) && !pageAppearsToContainForm(page.text)) {
    const reason = "フォームURLがお知らせ・ブログ等の記事ページで、入力フォームが無いため除外";

    return {
      candidate: {
        ...candidate,
        contactUrl: "",
        memo: [candidate.memo, `連絡先除外: ${reason} (${candidate.contactUrl})`].filter(Boolean).join("\n"),
        status: !candidate.email && candidate.status === "送信待ち" ? "見送り" : candidate.status
      },
      note: `除外: ${reason}`
    };
  }

  if (!isRedirectedElsewhere(candidate.contactUrl, page.finalUrl)) {
    return { candidate };
  }

  const final = new URL(page.finalUrl);
  const invalid =
    DEMO_PAGE_PATH_PATTERN.test(final.pathname) || normalizedPath(final) === "/" || !pageAppearsToContainForm(page.text);

  if (!invalid) {
    return {
      candidate: { ...candidate, contactUrl: page.finalUrl },
      note: `フォームURLの転送先に更新: ${candidate.contactUrl} -> ${page.finalUrl}`
    };
  }

  const reason = `フォームURLが別ページ(${page.finalUrl})へ転送され、本物のフォームではないため除外`;

  return {
    candidate: {
      ...candidate,
      contactUrl: "",
      memo: [candidate.memo, `連絡先除外: ${reason} (${candidate.contactUrl})`].filter(Boolean).join("\n"),
      status: !candidate.email && candidate.status === "送信待ち" ? "見送り" : candidate.status
    },
    note: `除外: ${reason}`
  };
};

const REQUIRED_MARK = "(?:必須|[*＊]|required)";
const BUDGET_OR_DEADLINE = "(?:予算|納期|希望時期|budget|deadline)";

// 打合せ・来店などの希望日時が必須入力の「予約・依頼専用フォーム」の項目名
const SCHEDULE_LABEL = "(?:打合せ|打ち合わせ|ミーティング|面談|来店|見学)?(?:ご)?希望日(?:時)?";

// 予算・希望納期・希望日時などが必須入力の「制作依頼・予約専用フォーム」かを判定する
export const isRequestOnlyForm = (html: string): boolean => {
  if (!pageAppearsToContainForm(html)) {
    return false;
  }

  const text = htmlToText(html).replace(/\s+/g, " ");
  const labelPattern = new RegExp(`${BUDGET_OR_DEADLINE}[^。.]{0,10}?${REQUIRED_MARK}`, "i");
  // 「必須 打合せご希望日時」のように、必須マークが項目名の前に付くサイトもある
  const markFirstSchedulePattern = new RegExp(`${REQUIRED_MARK}\\s*${SCHEDULE_LABEL}`, "i");

  if (labelPattern.test(text) || markFirstSchedulePattern.test(text)) {
    return true;
  }

  const fieldTags = html.match(/<(?:input|select|textarea)\b[^>]*>/gi) ?? [];
  const isRequiredTag = (tag: string): boolean => /(\brequired\b|aria-required="true"|validates-as-required)/i.test(tag);

  return fieldTags.some((tag) => {
    return (
      (/(budget|yosan|nouki|deadline|予算|納期)/i.test(tag) && isRequiredTag(tag)) ||
      // 日付の入力が必須のフォームは、予約・依頼専用の可能性が高い
      (/type=["']?date\b/i.test(tag) && isRequiredTag(tag))
    );
  });
};

export type RequestOnlyFormResult = {
  candidate: LeadCandidate;
  excluded?: { url: string; reason: string };
  replaced?: { from: string; to: string };
};

const GENERAL_CONTACT_PATH = /^\/(contact|contact-us|contactus|inquiry|toiawase|otoiawase|form)(\/|$)/i;

// 依頼・予約専用フォームだったとき、同じサイトの一般的な問い合わせページ（/contact/ など）に、使えるフォームがあれば探す
const findGeneralContactFallback = async (candidate: LeadCandidate, requestOnlyHtml: string): Promise<string | null> => {
  const sources = [candidate.contactUrl, candidate.officialSiteUrl].filter(Boolean);
  const currentKey = normalizeUrlKey(candidate.contactUrl);
  const tried = new Set<string>([currentKey]);
  const urls: string[] = [];

  for (const source of sources) {
    try {
      const html = source === candidate.contactUrl ? requestOnlyHtml : await fetchText(source);

      extractLinks(html, source).forEach((link) => {
        const path = new URL(link.url).pathname;
        const isGeneral = GENERAL_CONTACT_PATH.test(path) || /^(お問い合わせ|お問合せ|問い合わせ|contact)$/i.test(link.text.trim());

        if (isGeneral && !/(採用|求人|recruit|career|partner)/i.test(`${link.text} ${path}`) && !tried.has(normalizeUrlKey(link.url))) {
          tried.add(normalizeUrlKey(link.url));
          urls.push(link.url);
        }
      });
    } catch {
      // 取得できない場合は次の候補へ
    }
  }

  for (const url of urls.slice(0, 3)) {
    try {
      const page = await fetchPage(url);

      if (pageAppearsToContainForm(page.text) && !isRequestOnlyForm(page.text)) {
        // 転送されるリンク（/imake/contact/ → /contact/ など）は、転送先のURLを使う
        return page.finalUrl;
      }
    } catch {
      // 取得できない場合は次の候補へ
    }
  }

  return null;
};

export const excludeRequestOnlyForm = async (candidate: LeadCandidate): Promise<RequestOnlyFormResult> => {
  if (!candidate.contactUrl) {
    return { candidate };
  }

  let requestOnlyHtml = "";

  try {
    requestOnlyHtml = await fetchText(candidate.contactUrl);

    if (!isRequestOnlyForm(requestOnlyHtml)) {
      return { candidate };
    }
  } catch {
    // Best-effort only. Collection should not fail because a site blocks lightweight verification.
    return { candidate };
  }

  const fallbackUrl = await findGeneralContactFallback(candidate, requestOnlyHtml);

  if (fallbackUrl) {
    const note = `連絡先差し替え: ${candidate.contactUrl} は依頼・予約専用フォームのため、一般の問い合わせページ ${fallbackUrl} に変更`;

    return {
      candidate: { ...candidate, contactUrl: fallbackUrl, memo: [candidate.memo, note].filter(Boolean).join("\n") },
      replaced: { from: candidate.contactUrl, to: fallbackUrl }
    };
  }

  const reason = "予算・希望納期・希望日時などが必須の制作依頼・予約専用フォームのため、問い合わせ先から除外";
  const memo = [candidate.memo, `連絡先除外: ${reason} (${candidate.contactUrl})`].filter(Boolean).join("\n");
  const hasOtherContact = Boolean(candidate.email);

  return {
    candidate: {
      ...candidate,
      contactUrl: "",
      memo,
      status: hasOtherContact ? candidate.status : candidate.status === "送信待ち" ? "見送り" : candidate.status
    },
    excluded: { url: candidate.contactUrl, reason }
  };
};

export const verifyContactUrl = async (
  candidate: LeadCandidate
): Promise<ContactUrlVerificationResult> => {
  if (!candidate.contactUrl && !candidate.officialSiteUrl) {
    return { candidate };
  }

  for (const sourceUrl of candidateSourceUrls(candidate)) {
    try {
      const html = await fetchText(sourceUrl);
      const currentUrl = candidate.contactUrl || sourceUrl;
      const best = findBestContactLink(html, sourceUrl, candidate.leadType, currentUrl);
      const currentHasForm = candidate.contactUrl ? pageAppearsToContainForm(html) : false;

      if (!best) {
        continue;
      }

      const currentIsArticle = ARTICLE_PATH_PATTERN.test(safeUrl(currentUrl)?.pathname ?? "");
      const shouldReplace =
        best.score >= 70 || (!currentHasForm && best.score >= 50) || (currentIsArticle && !currentHasForm && best.score >= 35);

      if (shouldReplace) {
        return {
          candidate: {
            ...candidate,
            contactUrl: best.link.url
          },
          correction: {
            from: currentUrl,
            to: best.link.url,
            sourceUrl,
            reason: best.link.text || "問い合わせフォームへの詳細リンクを検出"
          }
        };
      }
    } catch {
      // Best-effort only. Collection should not fail because a site blocks lightweight verification.
    }
  }

  return { candidate };
};
