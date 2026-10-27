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

export type LinkCandidate = {
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

const PARTNER_FORM_PATTERN = /(制作パートナー|ビジネスパートナー|パートナー|協業|提携|業務委託|外注|partner|alliance|collabo)/i;

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

  if (/(相談|見積|依頼)/.test(haystack)) {
    score += 8;
  }

  // 資料ダウンロード・セミナー申込などは、/contact/ の下にあっても問い合わせ窓口ではない
  if (/(資料請求|資料ダウンロード|ダウンロード|download|ホワイトペーパー|whitepaper|セミナー|ウェビナー|webinar|イベント)/i.test(haystack)) {
    score -= 60;
  }

  // お知らせ・ブログなどの記事ページは、タイトルに「営業」「依頼」などが含まれていても、問い合わせ窓口ではない（例:「年末年始の営業につきまして」）
  if (ARTICLE_PATH_PATTERN.test(target.pathname)) {
    score -= 70;
  }

  // リンクの文言そのものが「パートナー募集」などのときは、制作会社・広告代理店への提案の窓口として優先する（パスに recruit があっても減点しない）
  if (isProductionOrAgencyLead(leadType) && /(パートナー募集|協力会社募集|外注先募集|業務委託募集|協業パートナー|ビジネスパートナー募集)/.test(link.text)) {
    score += 55;

    if (/(採用|求人|新卒|中途|recruit|career|entry|job)/i.test(haystack)) {
      score += 35;
    }
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

export const findBestContactLinks = (
  html: string,
  sourceUrl: string,
  leadType: string,
  currentUrl: string,
  limit = 3
): Array<{ link: LinkCandidate; score: number }> => {
  const currentKey = normalizeUrlKey(currentUrl);

  // 同じURLへのリンク（ヘッダー・フッター・本文に何度も出る）は、文言の長い（情報の多い）ものを1つだけにする
  const unique = new Map<string, LinkCandidate>();

  for (const link of extractLinks(html, sourceUrl)) {
    const key = normalizeUrlKey(link.url);
    const existing = unique.get(key);

    if (!existing || link.text.length > existing.text.length) {
      unique.set(key, link);
    }
  }

  return Array.from(unique.values())
    .filter((link) => normalizeUrlKey(link.url) !== currentKey)
    .map((link) => ({
      link,
      score: scoreContactLink(link, sourceUrl, leadType)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

// 補助金の解説記事など、リンク文言だけが近いページに、フォーム付きの問い合わせページを差し替えないための確認
const hasUsableForm = async (url: string): Promise<boolean> => {
  try {
    const html = await fetchText(url);
    return pageAppearsToContainForm(html) && !isRequestOnlyForm(html);
  } catch {
    return false;
  }
};

// 入口のページ（フォームが無く、窓口へのリンクだけがあるページ）の中から、入力フォームのある窓口を探す。
// 1段目のリンクにフォームが無くても、入口が「パートナー募集」などの協業の窓口なら、その配下のページ（職種ごとのページなど）を、あと2段までたどる。
// 確認するページ数に上限を付ける（1つの入口につき最大12ページ）
const DEEP_CRAWL_PAGE_LIMIT = 12;
const APPLY_LINK_PATTERN = /(応募|エントリー|apply|entry|フォーム|form)/i;

const findDeeperContactLink = async (entranceUrl: string, leadType: string, entranceText = ""): Promise<LinkCandidate | null> => {
  const entrance = safeUrl(entranceUrl);

  if (!entrance) {
    return null;
  }

  try {
    const entranceHtml = await fetchText(entranceUrl);

    // 入口が協業の窓口（パートナー募集など）のときは、ヘッダー・フッターにある一般の問い合わせリンクではなく、その配下の窓口を探す
    const isPartnerSection = PARTNER_FORM_PATTERN.test(`${entranceText} ${entrance.pathname}`) && isProductionOrAgencyLead(leadType);
    const sectionPath = entrance.pathname.replace(/\/$/, "");

    for (const best of findBestContactLinks(entranceHtml, entranceUrl, leadType, entranceUrl, 5)) {
      const target = safeUrl(best.link.url);
      const inSection = target !== null && (target.pathname.startsWith(`${sectionPath}/`) || APPLY_LINK_PATTERN.test(`${best.link.text} ${target.pathname}`));

      if (isPartnerSection && !inSection) {
        continue;
      }

      if (best.score >= 70 && (await hasUsableForm(best.link.url))) {
        return best.link;
      }
    }

    // ここから先は、協業の窓口（パートナー募集など）の配下に限る
    if (!isPartnerSection) {
      return null;
    }

    const sectionPrefix = sectionPath;
    const visited = new Set<string>([normalizeUrlKey(entranceUrl)]);
    let level: Array<{ url: string; html: string }> = [{ url: entranceUrl, html: entranceHtml }];
    let fetched = 1;

    for (let depth = 0; depth < 2 && level.length > 0; depth += 1) {
      const next: Array<{ url: string; html: string }> = [];

      for (const page of level) {
        const links = extractLinks(page.html, page.url).filter((link) => {
          const target = safeUrl(link.url);

          return (
            target !== null &&
            !visited.has(normalizeUrlKey(link.url)) &&
            !ARTICLE_PATH_PATTERN.test(target.pathname) &&
            (target.pathname.startsWith(`${sectionPrefix}/`) || APPLY_LINK_PATTERN.test(`${link.text} ${target.pathname}`))
          );
        });
        // 応募・フォームを思わせるリンクを先に確認する
        links.sort((a, b) => Number(APPLY_LINK_PATTERN.test(`${b.text} ${b.url}`)) - Number(APPLY_LINK_PATTERN.test(`${a.text} ${a.url}`)));

        for (const link of links) {
          if (fetched >= DEEP_CRAWL_PAGE_LIMIT) {
            return null;
          }

          visited.add(normalizeUrlKey(link.url));
          fetched += 1;
          let html: string;

          try {
            html = await fetchText(link.url);
          } catch {
            continue;
          }

          if (pageAppearsToContainForm(html) && !isRequestOnlyForm(html)) {
            return link;
          }

          next.push({ url: link.url, html });
        }
      }

      level = next;
    }
  } catch {
    // 取得できなければ、1段目のままにする
  }

  return null;
};

const isRequestOnlyPage = async (url: string): Promise<boolean> => {
  try {
    return isRequestOnlyForm(await fetchText(url));
  } catch {
    return false;
  }
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

  // 「上限予算※」のように、項目名の直後に ※ が付くサイトもある（※ を必須の印にしている。注記の※と区別するため、項目名にすぐ続く場合だけ）
  const noteMarkBudgetPattern = /(?:予算|納期|希望時期)(?:額|金額)?\s?※/;

  if (labelPattern.test(text) || markFirstSchedulePattern.test(text) || noteMarkBudgetPattern.test(text)) {
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

  // 今のフォームURLのページに入力フォームがあるか。公式サイトのトップなど、他のページを調べているときも、この結果を使う
  const contactPageHasForm = candidate.contactUrl
    ? await fetchText(candidate.contactUrl).then(pageAppearsToContainForm, () => false)
    : false;

  let fallback: { best: { link: LinkCandidate; score: number }; sourceUrl: string; currentUrl: string } | null = null;

  for (const sourceUrl of candidateSourceUrls(candidate)) {
    try {
      const html = await fetchText(sourceUrl);
      const currentUrl = candidate.contactUrl || sourceUrl;
      const currentHasForm = contactPageHasForm;
      const currentIsArticle = ARTICLE_PATH_PATTERN.test(safeUrl(currentUrl)?.pathname ?? "");
      // 今のURLが、すでに協業・パートナー向けのフォームなら、そうした言葉を含まない別ページには差し替えない
      const currentIsPartnerForm = contactPageHasForm && PARTNER_FORM_PATTERN.test(safeUrl(currentUrl)?.pathname ?? "");

      for (const best of findBestContactLinks(html, sourceUrl, candidate.leadType, currentUrl)) {
        const shouldReplace =
          best.score >= 70 || (!currentHasForm && best.score >= 50) || (currentIsArticle && !currentHasForm && best.score >= 35);

        // 今のURLが入力フォームのあるページなら、差し替え先もフォームのあるページである場合だけ差し替える
        if (!shouldReplace || (currentHasForm && !(await hasUsableForm(best.link.url)))) {
          continue;
        }

        if (currentIsPartnerForm && !PARTNER_FORM_PATTERN.test(`${best.link.text} ${safeUrl(best.link.url)?.pathname ?? ""}`)) {
          continue;
        }

        // 予約・依頼専用のフォームは、協業・パートナー提案の送信先にならないので、次の候補を見る
        if (!currentHasForm && (await isRequestOnlyPage(best.link.url))) {
          continue;
        }

        // 見つけたページが入口だけ（入力フォームが無い）で、その中に「パートナー募集」などの窓口へのリンクがあれば、もう1段、たどる。
        // たどれず、フォームも無いページは、ほかに使える窓口が見つからなかったときの代わりとして、取っておく
        let deeper: LinkCandidate | null = null;

        if (!currentHasForm && !(await hasUsableForm(best.link.url))) {
          deeper = await findDeeperContactLink(best.link.url, candidate.leadType, best.link.text);

          if (!deeper) {
            fallback ??= { best, sourceUrl, currentUrl };
            continue;
          }
        }

        const chosen = deeper ?? best.link;

        return {
          candidate: {
            ...candidate,
            contactUrl: chosen.url
          },
          correction: {
            from: currentUrl,
            to: chosen.url,
            sourceUrl,
            reason: deeper ? `${best.link.text || best.link.url} のページ内の「${deeper.text || deeper.url}」を検出` : best.link.text || "問い合わせフォームへの詳細リンクを検出"
          }
        };
      }
    } catch {
      // Best-effort only. Collection should not fail because a site blocks lightweight verification.
    }
  }

  if (fallback) {
    return {
      candidate: { ...candidate, contactUrl: fallback.best.link.url },
      correction: {
        from: fallback.currentUrl,
        to: fallback.best.link.url,
        sourceUrl: fallback.sourceUrl,
        reason: fallback.best.link.text || "問い合わせフォームへの詳細リンクを検出"
      }
    };
  }

  return { candidate };
};
