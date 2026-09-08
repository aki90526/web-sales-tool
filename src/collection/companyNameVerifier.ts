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

const isSameCompanyCore = (candidateName: string, officialName: string): boolean => {
  const candidateCore = stripLegalForm(candidateName);
  const officialCore = stripLegalForm(officialName);

  return candidateCore.length >= 2 && officialCore.length >= 2 && candidateCore === officialCore;
};

const decodeHtmlEntities = (value: string): string => {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

const htmlToText = (html: string): string => {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
};

const fetchText = async (url: string, redirects = 0): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "http:" ? http : https;
    const request = transport.get(
      parsed,
      {
        headers: {
          "user-agent": "web-sales-tool/0.1 company-name-verifier"
        }
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirects < 3) {
          response.resume();
          const nextUrl = new URL(location, parsed).toString();
          fetchText(nextUrl, redirects + 1).then(resolve, reject);
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
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );

    request.on("error", reject);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Company name verification timed out")));
  });
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
      .filter((value) => LEGAL_FORMS.some((legalForm) => value.includes(legalForm)))
  ));
};

export const verifyCompanyName = async (
  candidate: LeadCandidate
): Promise<CompanyNameVerificationResult> => {
  const candidateCore = stripLegalForm(candidate.companyName);

  if (candidateCore.length < 2) {
    return { candidate };
  }

  for (const sourceUrl of candidateVerificationUrls(candidate.officialSiteUrl)) {
    try {
      const html = await fetchText(sourceUrl);
      const legalNames = extractLegalCompanyNames(htmlToText(html));
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

  return { candidate };
};
