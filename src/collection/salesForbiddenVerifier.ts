import { detectSalesForbidden } from "../domain/salesForbiddenDetection";
import { BROWSER_FETCH_OPTIONS, fetchPage, htmlToText } from "./companyNameVerifier";

// 営業目的の連絡の禁止（営業お断り）が、実際にサイトに書かれているかを、ページの文章で確かめる。
// 収集のAIが「営業目的の問い合わせ禁止」と判断しても、「営業は返信しない場合がある」のような、禁止ではない表現を、誤って禁止と読むことがあるため。

export type SalesForbiddenCheck = {
  // true: 禁止の記載を確認できた / false: 確認したページに、禁止の記載がなかった / null: ページを取得できず、確かめられなかった
  confirmed: boolean | null;
  excerpt: string;
  checkedUrls: string[];
};

const candidatePages = (officialSiteUrl: string, contactUrl: string): string[] => {
  const pages = [contactUrl, officialSiteUrl];

  try {
    const origin = new URL(officialSiteUrl).origin;
    pages.push(`${origin}/contact/`, `${origin}/inquiry/`, `${origin}/company/`);
  } catch {
    // 公式サイトのURLが読めないときは、渡されたものだけ
  }

  return Array.from(new Set(pages.filter((url) => /^https?:\/\//i.test(url)))).slice(0, 5);
};

export const checkSalesForbiddenOnSite = async (officialSiteUrl: string, contactUrl: string): Promise<SalesForbiddenCheck> => {
  const checkedUrls: string[] = [];

  for (const url of candidatePages(officialSiteUrl, contactUrl)) {
    try {
      const html = (await fetchPage(url, 0, BROWSER_FETCH_OPTIONS)).text;
      checkedUrls.push(url);
      const excerpt = detectSalesForbidden(htmlToText(html));

      if (excerpt) {
        return { confirmed: true, excerpt, checkedUrls };
      }
    } catch {
      // 開けないページは、飛ばす
    }
  }

  return { confirmed: checkedUrls.length > 0 ? false : null, excerpt: "", checkedUrls };
};

const isForbidClaim = (entry: Record<string, unknown>): boolean => {
  const reason = typeof entry.exclusionReason === "string" ? entry.exclusionReason : "";
  const signals = (entry.scoreSignals && typeof entry.scoreSignals === "object" ? entry.scoreSignals : {}) as Record<string, unknown>;
  const truthy = (value: unknown): boolean => value === true || value === "true";

  return (
    (/(営業|セールス|売り込み|広告|宣伝)/.test(reason) && /(禁止|お断り|不可)/.test(reason)) ||
    truthy(signals.forbidsSalesContact) ||
    truthy(entry.forbidsSalesContact) ||
    truthy(signals.forbidsAdsMail) ||
    truthy(entry.forbidsAdsMail)
  );
};

// AIの返した候補（生のJSON）のうち、「営業禁止」と判断されたものを、ページの文章で確かめる。
// 禁止の記載を確認できなかったものは、その判断（除外の理由と、禁止のフラグ）を取り消し、メモに理由を残す。
// ページを取得できなかったものは、そのままにする
export const reviewSalesForbiddenClaims = async (entries: unknown[]): Promise<number> => {
  let cleared = 0;

  for (const raw of entries) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const entry = raw as Record<string, unknown>;

    if (!isForbidClaim(entry)) {
      continue;
    }

    const officialSiteUrl = typeof entry.officialSiteUrl === "string" ? entry.officialSiteUrl : "";
    const contactUrl = typeof entry.contactUrl === "string" ? entry.contactUrl : "";
    const check = await checkSalesForbiddenOnSite(officialSiteUrl, contactUrl);

    if (check.confirmed !== false) {
      continue;
    }

    const originalReason = typeof entry.exclusionReason === "string" ? entry.exclusionReason : "営業目的の問い合わせ禁止";
    const signals = (entry.scoreSignals && typeof entry.scoreSignals === "object" ? entry.scoreSignals : {}) as Record<string, unknown>;

    signals.forbidsSalesContact = false;
    signals.forbidsAdsMail = false;
    entry.scoreSignals = signals;
    entry.forbidsSalesContact = false;
    entry.forbidsAdsMail = false;
    entry.exclusionReason = "";
    entry.memo = [
      typeof entry.memo === "string" ? entry.memo : "",
      `AIは「${originalReason}」と判断しましたが、ページに禁止の記載を確認できなかったため、除外していません（確認したページ: ${check.checkedUrls.join(" / ")}）`
    ]
      .filter(Boolean)
      .join("\n");
    cleared += 1;
  }

  return cleared;
};
