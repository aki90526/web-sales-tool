import { LeadCandidate } from "../openai/leadCandidateCollector";
import { decodeHtmlEntities, fetchText, htmlToText } from "./companyNameVerifier";

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

      const shouldReplace = best.score >= 70 || (!currentHasForm && best.score >= 50);

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
