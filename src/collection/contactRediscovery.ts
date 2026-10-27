import { SalesManagementLead } from "../google/salesManagementRepository";
import { BROWSER_FETCH_OPTIONS, fetchPage } from "./companyNameVerifier";
import { findBestContactLinks, verifyContactUrl } from "./contactUrlVerifier";
import { findEmailOnSite } from "./emailFinder";
import { assessForm, isArticleUrl } from "./rejectedRecheck";
import { LeadCandidate } from "../openai/leadCandidateCollector";

// リードの連絡先を、公式サイトから探し直す（画面の「連絡先を再探索」ボタン用）。
// ルールだけで動き、AIは使わない（費用なし）。結果は提案として返すだけで、シートは書き換えない。
// 適用するかは、画面で、阿部が決める（フォームURL・メールアドレスの登録は、既存の登録の処理を使う）。

export type ContactCandidateJudgment = {
  url: string;
  label: string;
  ok: boolean;
  // 使えない理由。使えるときは空
  reason: string;
};

export type RediscoveryResult = {
  leadId: string;
  companyName: string;
  officialSiteUrl: string;
  current: { formUrl: string; email: string; formJudgment: ContactCandidateJudgment | null };
  // 公式サイトで見つけた、フォームの候補と、それぞれの判定（上位から）
  candidates: ContactCandidateJudgment[];
  // おすすめのフォームURL（使える候補のうち、いちばん上。無ければ空）
  recommendedFormUrl: string;
  // 公式サイトで見つけたメールアドレス（いま登録のものと同じ、または見つからなければ null）
  foundEmail: { email: string; sourceUrl: string } | null;
};

const MAX_CANDIDATES = 6;

const judge = async (url: string, label: string): Promise<ContactCandidateJudgment> => {
  if (isArticleUrl(url)) {
    return { url, label, ok: false, reason: "お知らせ・ブログなどの記事ページで、問い合わせフォームではない" };
  }

  const result = await assessForm(url);

  return { url, label, ok: result.ok, reason: result.reason };
};

export const rediscoverContact = async (lead: SalesManagementLead): Promise<RediscoveryResult> => {
  const result: RediscoveryResult = {
    leadId: lead.leadId,
    companyName: lead.companyName,
    officialSiteUrl: lead.officialSiteUrl,
    current: { formUrl: lead.contactFormUrl, email: lead.emailAddress, formJudgment: null },
    candidates: [],
    recommendedFormUrl: "",
    foundEmail: null
  };

  if (!lead.officialSiteUrl) {
    return result;
  }

  // いま登録されているフォームの判定
  if (lead.contactFormUrl) {
    result.current.formJudgment = await judge(lead.contactFormUrl, "登録中のフォーム");
  }

  // 公式サイトの、問い合わせらしいリンクを、点数順に（記事ページは点数が低い）。同じURLは1回だけ判定する
  const seen = new Set<string>([lead.contactFormUrl]);
  const urls: Array<{ url: string; label: string }> = [];

  try {
    const home = (await fetchPage(lead.officialSiteUrl, 0, BROWSER_FETCH_OPTIONS)).text;

    for (const best of findBestContactLinks(home, lead.officialSiteUrl, lead.leadType, lead.contactFormUrl, MAX_CANDIDATES)) {
      if (best.score >= 30 && !seen.has(best.link.url)) {
        seen.add(best.link.url);
        urls.push({ url: best.link.url, label: best.link.text || "サイト内のリンク" });
      }
    }
  } catch {
    // 公式サイトを開けないときは、その旨を、理由に出す
    result.candidates.push({ url: lead.officialSiteUrl, label: "公式サイト", ok: false, reason: "公式サイトを開けない" });
    return result;
  }

  // 通常の探索（もう1段たどる、パートナー募集の配下を探す、など）の結果も、候補に入れる
  try {
    const stub = {
      companyName: lead.companyName,
      leadType: lead.leadType,
      officialSiteUrl: lead.officialSiteUrl,
      contactUrl: "",
      email: "",
      memo: "",
      status: "見送り",
      recommendedApproach: "見送り"
    } as unknown as LeadCandidate;
    const found = (await verifyContactUrl(stub)).candidate.contactUrl;

    if (found && !seen.has(found)) {
      seen.add(found);
      urls.unshift({ url: found, label: "自動探索の結果" });
    }
  } catch {
    // 探索に失敗しても、ほかの候補は判定する
  }

  for (const entry of urls.slice(0, MAX_CANDIDATES)) {
    result.candidates.push(await judge(entry.url, entry.label));
  }

  result.recommendedFormUrl = result.candidates.find((candidate) => candidate.ok)?.url ?? "";

  // メールアドレス（公式サイト・会社概要・問い合わせページ。HTMLの中の mailto: も見る）
  try {
    const email = await findEmailOnSite(lead.officialSiteUrl, result.recommendedFormUrl || lead.contactFormUrl);

    if (email && email.email.toLowerCase() !== lead.emailAddress.toLowerCase()) {
      result.foundEmail = email;
    }
  } catch {
    // 見つからない扱い
  }

  return result;
};
