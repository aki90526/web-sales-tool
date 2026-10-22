import { BROWSER_FETCH_OPTIONS, fetchText as fetchTextBase, htmlToText } from "./companyNameVerifier";

const fetchText = (url: string): Promise<string> => fetchTextBase(url, 0, BROWSER_FETCH_OPTIONS);

export type FoundEmail = {
  email: string;
  sourceUrl: string;
};

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const IGNORED_EMAIL_PATTERN =
  /(example\.|sample\.|your-?(?:name|mail|email|address)|youremail|test@|noreply|no-reply|donotreply|wixpress|sentry|\.(?:png|jpe?g|gif|svg|webp)(?:$|@)|@\d+x$|domain\.com|email\.com|^(?:privacy|privacypolicy|personal|abuse|security|dpo|compliance|recruit|saiyo|career|careers|jobs|press|ir)@)/i;
const PREFERRED_PREFIX_PATTERN = /^(info|contact|inquiry|support|hello|sales|mail|office|webmaster|toiawase|otoiawase)@/i;

// Cloudflareのメール難読化（data-cfemail）を元のアドレスに戻す
const decodeCloudflareEmail = (encoded: string): string => {
  try {
    const key = parseInt(encoded.slice(0, 2), 16);
    let email = "";

    for (let index = 2; index < encoded.length; index += 2) {
      email += String.fromCharCode(parseInt(encoded.slice(index, index + 2), 16) ^ key);
    }

    return email;
  } catch {
    return "";
  }
};

const extractEmails = (html: string): string[] => {
  const emails: string[] = [];

  for (const match of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
    emails.push(decodeURIComponent(match[1]).trim());
  }

  for (const match of html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) {
    emails.push(decodeCloudflareEmail(match[1]));
  }

  emails.push(...(htmlToText(html).match(EMAIL_PATTERN) ?? []));

  return emails
    .map((email) => email.trim().replace(/[.,;:)]+$/, "").toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !IGNORED_EMAIL_PATTERN.test(email));
};

const registrableDomain = (host: string): string => host.toLowerCase().replace(/^www\./, "").split(".").slice(-3).join(".");

const sameSite = (email: string, siteUrl: string): boolean => {
  try {
    const emailDomain = email.split("@")[1] ?? "";
    const siteHost = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");

    return siteHost === emailDomain || siteHost.endsWith(`.${emailDomain}`) || emailDomain.endsWith(`.${siteHost}`) ||
      registrableDomain(siteHost) === registrableDomain(emailDomain);
  } catch {
    return false;
  }
};

const candidatePages = (officialSiteUrl: string, contactUrl: string, homeHtml: string): string[] => {
  const pages = [officialSiteUrl, contactUrl].filter(Boolean);

  try {
    const origin = new URL(officialSiteUrl).origin;

    for (const match of homeHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = htmlToText(match[2]);
      const href = match[1];

      if (!/(会社概要|会社案内|企業情報|about|company|お問い合わせ|お問合せ|contact)/i.test(`${text} ${href}`)) {
        continue;
      }

      const url = new URL(href, officialSiteUrl);

      if (url.origin === origin && !/(\/elements\/|\/demo\/|\/sample\/)/i.test(url.pathname)) {
        pages.push(url.toString());
      }
    }
  } catch {
    // Best-effort only.
  }

  return Array.from(new Set(pages)).slice(0, 6);
};

// 公式サイト・会社概要・お問い合わせページからメールアドレスを探す。見つからなければ null
export const findEmailOnSite = async (officialSiteUrl: string, contactUrl: string): Promise<FoundEmail | null> => {
  if (!officialSiteUrl) {
    return null;
  }

  let homeHtml = "";

  try {
    homeHtml = await fetchText(officialSiteUrl);
  } catch {
    return null;
  }

  const counts = new Map<string, { count: number; sourceUrl: string; mailto: boolean }>();

  for (const pageUrl of candidatePages(officialSiteUrl, contactUrl, homeHtml)) {
    let html = pageUrl === officialSiteUrl ? homeHtml : "";

    if (!html) {
      try {
        html = await fetchText(pageUrl);
      } catch {
        continue;
      }
    }

    const mailtoEmails = new Set(
      Array.from(html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)).map((match) => decodeURIComponent(match[1]).trim().toLowerCase())
    );

    for (const email of extractEmails(html)) {
      const current = counts.get(email);

      counts.set(email, {
        count: (current?.count ?? 0) + 1,
        sourceUrl: current?.sourceUrl ?? pageUrl,
        mailto: (current?.mailto ?? false) || mailtoEmails.has(email)
      });
    }
  }

  const ranked = Array.from(counts.entries())
    .map(([email, info]) => ({
      email,
      sourceUrl: info.sourceUrl,
      score:
        (sameSite(email, officialSiteUrl) ? 100 : 0) +
        (info.mailto ? 30 : 0) +
        (PREFERRED_PREFIX_PATTERN.test(email) ? 20 : 0) +
        Math.min(info.count, 5)
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];

  return best ? { email: best.email, sourceUrl: best.sourceUrl } : null;
};
