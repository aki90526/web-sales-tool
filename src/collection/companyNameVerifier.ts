import http from "http";
import https from "https";
import { LeadCandidate } from "../openai/leadCandidateCollector";

export type CompanyNameVerificationResult = {
  candidate: LeadCandidate;
  correction?: {
    from: string;
    to: string;
    sourceUrl: string;
  };
};

const LEGAL_FORMS = [
  "株式会社",
  "有限会社",
  "合同会社",
  "合資会社",
  "合名会社",
  "一般社団法人",
  "一般財団法人",
  "特定非営利活動法人",
  "NPO法人"
];

const MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const stripLegalForm = (value: string): string => {
  let stripped = value;

  LEGAL_FORMS.forEach((legalForm) => {
    stripped = stripped.replace(new RegExp(escapeRegExp(legalForm), "g"), "");
  });

  return stripped
    .replace(/[（）()[\]【】「」『』|｜\-‐ー–—・.,，。:：\s]/g, "")
    .trim();
};

const normalizeCompanyName = (value: string): string => {
  return value
    .replace(/\s+/g, "")
    .replace(/[（）()[\]【】「」『』|｜\-‐–—・.,，。:：]/g, "")
    .trim();
};

const countLegalForms = (value: string): number => {
  return LEGAL_FORMS.reduce((count, legalForm) => {
    return count + (value.match(new RegExp(escapeRegExp(legalForm), "g")) ?? []).length;
  }, 0);
};

// 「株式会社ライズエージェンシー 株式会社」のように法人格が二重になった名前を、
// サイト本文に実際に出てくる表記（前株・後株）で1つにまとめる。本文で判断できなければ先頭の法人格を残す。
const resolveDuplicateLegalForm = (companyName: string, text: string): string => {
  const legalForm = LEGAL_FORMS.find((form) => companyName.includes(form));

  if (!legalForm) {
    return companyName;
  }

  const core = companyName.split(legalForm).join("").replace(/\s+/g, " ").trim();
  const compactText = text.replace(/\s+/g, "");
  const compactCore = core.replace(/\s+/g, "");
  const prefixed = `${legalForm}${core}`;
  const suffixed = `${core}${legalForm}`;
  const prefixedCount = compactText.split(`${legalForm}${compactCore}`).length - 1;
  const suffixedCount = compactText.split(`${compactCore}${legalForm}`).length - 1;

  if (suffixedCount > 0 && suffixedCount >= prefixedCount) {
    return suffixed;
  }

  return companyName.trim().startsWith(legalForm) || prefixedCount > 0 ? prefixed : suffixed;
};

const isSameCompanyCore = (candidateName: string, officialName: string): boolean => {
  const candidateCore = stripLegalForm(candidateName);
  const officialCore = stripLegalForm(officialName);

  return candidateCore.length >= 2 && officialCore.length >= 2 && candidateCore === officialCore;
};

export const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

export const htmlToText = (html: string): string => {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
};

export type FetchTextOptions = {
  userAgent?: string;
  timeoutMs?: number;
};

// 簡易ボット判定で止められるサイトがあるため、ブラウザ相当のUser-Agentと長めのタイムアウトで取得する場合に使う
export const BROWSER_FETCH_OPTIONS: FetchTextOptions = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  timeoutMs: 15000
};

export type FetchedPage = {
  text: string;
  finalUrl: string;
};

export const fetchPage = async (url: string, redirects = 0, options: FetchTextOptions = {}): Promise<FetchedPage> => {
  return new Promise<FetchedPage>((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "http:" ? http : https;
    const request = transport.get(
      parsed,
      {
        headers: {
          "user-agent": options.userAgent ?? "web-sales-tool/0.1 company-name-verifier"
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirects < 3) {
          response.resume();
          const nextUrl = new URL(location, parsed).toString();
          fetchPage(nextUrl, redirects + 1, options).then(resolve, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Unexpected status ${statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;

        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;

          if (totalBytes > MAX_BYTES) {
            request.destroy(new Error("Response too large"));
            return;
          }

          chunks.push(chunk);
        });
        response.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), finalUrl: parsed.toString() }));
      }
    );

    request.on("error", reject);
    request.setTimeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Company name verification timed out")));
  });
};

export const fetchText = async (url: string, redirects = 0, options: FetchTextOptions = {}): Promise<string> => {
  return (await fetchPage(url, redirects, options)).text;
};

const candidateVerificationUrls = (officialSiteUrl: string): string[] => {
  const url = new URL(officialSiteUrl);
  const origin = url.origin;
  const current = url.toString();
  const candidates = [
    current,
    origin,
    `${origin}/about/`,
    `${origin}/company/`,
    `${origin}/profile/`,
    `${origin}/about`,
    `${origin}/company`,
    `${origin}/profile`
  ];

  return Array.from(new Set(candidates));
};

const extractLegalCompanyNames = (text: string): string[] => {
  const legalFormPattern = LEGAL_FORMS.map(escapeRegExp).join("|");
  const nameChars = "[一-龠々ぁ-んァ-ヶーA-Za-z0-9０-９ａ-ｚＡ-Ｚ&＆・.．\\-\\s]{1,50}";
  const prefixPattern = new RegExp(`(?:${legalFormPattern})\\s*${nameChars}`, "g");
  const suffixPattern = new RegExp(`${nameChars}\\s*(?:${legalFormPattern})`, "g");
  const matches = [
    ...text.matchAll(prefixPattern),
    ...text.matchAll(suffixPattern)
  ].map((match) => match[0]);

  return Array.from(new Set(
    matches
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter((value) => countLegalForms(value) === 1)
  ));
};

export const verifyCompanyName = async (
  candidate: LeadCandidate
): Promise<CompanyNameVerificationResult> => {
  const candidateCore = stripLegalForm(candidate.companyName);

  if (candidateCore.length < 2) {
    return { candidate };
  }

  const hasDuplicateLegalForm = countLegalForms(candidate.companyName) >= 2;

  for (const sourceUrl of candidateVerificationUrls(candidate.officialSiteUrl)) {
    try {
      const html = await fetchText(sourceUrl);
      const text = htmlToText(html);

      if (hasDuplicateLegalForm) {
        const resolvedName = resolveDuplicateLegalForm(candidate.companyName, text);
        return {
          candidate: { ...candidate, companyName: resolvedName },
          correction: { from: candidate.companyName, to: resolvedName, sourceUrl }
        };
      }

      const legalNames = extractLegalCompanyNames(text);
      const officialName = legalNames.find((name) => isSameCompanyCore(candidate.companyName, name));

      if (officialName && normalizeCompanyName(officialName) !== normalizeCompanyName(candidate.companyName)) {
        return {
          candidate: {
            ...candidate,
            companyName: officialName
          },
          correction: {
            from: candidate.companyName,
            to: officialName,
            sourceUrl
          }
        };
      }

      if (officialName) {
        return { candidate };
      }
    } catch {
      // Verification is a best-effort guard. Collection should not fail only because a site blocks access.
    }
  }

  if (hasDuplicateLegalForm) {
    const resolvedName = resolveDuplicateLegalForm(candidate.companyName, "");
    return {
      candidate: { ...candidate, companyName: resolvedName },
      correction: { from: candidate.companyName, to: resolvedName, sourceUrl: candidate.officialSiteUrl }
    };
  }

  return { candidate };
};
