import { daysBetween, readResendSettings, todayInTokyo } from "../domain/resend";
import { SHEETS } from "../domain/lead";
import { detectSalesForbidden } from "../domain/salesForbiddenDetection";
import { fieldRangeForRow, readSalesManagementTable, SalesManagementLead, statusRangeForRow } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";
import { LeadCandidate } from "../openai/leadCandidateCollector";
import { BROWSER_FETCH_OPTIONS, fetchPage, htmlToText } from "./companyNameVerifier";
import { checkFormPresence, excludeRequestOnlyForm, isRequestOnlyForm, verifyContactUrl } from "./contactUrlVerifier";
import { findEmailOnSite } from "./emailFinder";

// 「見送り」のリードを、一定の間隔で再確認する。
//  公式サイトが開く / 営業お断りの記載がない / 連絡先（メールかフォーム）がある / フォームが依頼・予約専用ではない、を満たせば「送信できる」と判断する。
//  ただし「送信待ち」に自動で戻すのは、次のどちらかの場合だけにする（過去に送信を試して失敗した連絡先を、くり返し試さないため）。
//   - 連絡先が未登録だったが、今回見つかった
//   - 以前はサイトが開けず見送りにしていたが、今回は開いた
//  それ以外は見送りのまま、確認日だけをメモに残す。「除外」と、返信のあったリードは対象外。

const RECHECK_LINE_PREFIX = "見送りの再確認:";
const SITE_DOWN_MEMO_PATTERN = /(サイトが開け|サイトにアクセスできな|サイトが表示されな|サイトが見られな|公式サイトが開け)/;
const REACTED_REPLY_STATUSES = new Set(["返信あり", "再送案内"]);

export type RecheckResult = {
  leadId: string;
  companyName: string;
  outcome: "revived" | "unchanged";
  detail: string;
};

type Assessment = {
  sendable: boolean;
  reason: string;
  foundFormUrl?: string;
  foundEmail?: string;
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const stubCandidate = (lead: SalesManagementLead): LeadCandidate => {
  return {
    companyName: lead.companyName,
    leadType: lead.leadType,
    officialSiteUrl: lead.officialSiteUrl,
    contactUrl: lead.contactFormUrl,
    email: lead.emailAddress,
    memo: "",
    status: "見送り",
    recommendedApproach: "見送り"
  } as unknown as LeadCandidate;
};

// 登録済み、または見つけたフォームが、営業に使えるかを確認する
const assessForm = async (formUrl: string): Promise<{ ok: boolean; reason: string }> => {
  let html: string;

  try {
    html = (await fetchPage(formUrl, 0, BROWSER_FETCH_OPTIONS)).text;
  } catch {
    return { ok: false, reason: "フォームのページを開けない" };
  }

  const forbidden = detectSalesForbidden(htmlToText(html));

  if (forbidden) {
    return { ok: false, reason: `営業お断りの記載: 「${forbidden}」` };
  }

  if (isRequestOnlyForm(html)) {
    return { ok: false, reason: "依頼・予約専用のフォーム" };
  }

  const presence = await checkFormPresence(formUrl);

  if (presence.warning) {
    return { ok: false, reason: "フォームが見当たらない" };
  }

  return { ok: true, reason: "" };
};

const assessLead = async (lead: SalesManagementLead): Promise<Assessment> => {
  let siteText: string;

  try {
    siteText = htmlToText((await fetchPage(lead.officialSiteUrl, 0, BROWSER_FETCH_OPTIONS)).text);
  } catch {
    return { sendable: false, reason: "公式サイトにアクセスできない" };
  }

  const forbidden = detectSalesForbidden(siteText);

  if (forbidden) {
    return { sendable: false, reason: `営業お断りの記載: 「${forbidden}」` };
  }

  if (lead.emailAddress) {
    return { sendable: true, reason: "" };
  }

  if (lead.contactFormUrl) {
    const form = await assessForm(lead.contactFormUrl);
    return form.ok ? { sendable: true, reason: "" } : { sendable: false, reason: form.reason };
  }

  // 連絡先が未登録: 公式サイトから探す
  let candidate = stubCandidate(lead);

  try {
    candidate = (await verifyContactUrl(candidate)).candidate;

    if (candidate.contactUrl) {
      candidate = (await excludeRequestOnlyForm(candidate)).candidate;
    }
  } catch {
    // 連絡先の探索に失敗しても、メールの探索は続ける
  }

  if (candidate.contactUrl) {
    const form = await assessForm(candidate.contactUrl);

    if (form.ok) {
      return { sendable: true, reason: "", foundFormUrl: candidate.contactUrl };
    }
  }

  try {
    const found = await findEmailOnSite(lead.officialSiteUrl, "");

    if (found) {
      return { sendable: true, reason: "", foundEmail: found.email };
    }
  } catch {
    // 見つからなかった扱い
  }

  return { sendable: false, reason: "連絡先を見つけられない" };
};

const lastCheckedDate = (memo: string): string => {
  const lines = memo.split("\n");
  const recheck = lines.filter((line) => line.startsWith(RECHECK_LINE_PREFIX)).pop();
  const fromRecheck = recheck ? /(\d{4}-\d{2}-\d{2})/.exec(recheck)?.[1] : undefined;

  if (fromRecheck) {
    return fromRecheck;
  }

  // 見送りにした日（ステータス変更の履歴）を起点にする。履歴がなければ空（すぐ確認する）
  const changed = lines
    .filter((line) => /^ステータス変更: .* → 見送り \(\d{4}-\d{2}-\d{2}/.test(line))
    .pop();

  return changed ? (/(\d{4}-\d{2}-\d{2})/.exec(changed)?.[1] ?? "") : "";
};

const replaceRecheckLine = (memo: string, line: string): string => {
  const kept = memo.split("\n").filter((entry) => !entry.startsWith(RECHECK_LINE_PREFIX));
  return [...kept, line].join("\n").trim();
};

const readReactedLeadIds = async (sheets: SheetsClient): Promise<Set<string>> => {
  const rows = await sheets.getValues(`'${SHEETS.approachHistory}'!A2:J`);
  const ids = new Set<string>();

  rows.forEach((row) => {
    if (REACTED_REPLY_STATUSES.has(String(row[8] ?? "").trim())) {
      ids.add(String(row[0] ?? "").trim());
    }
  });

  return ids;
};

export const recheckRejectedLeads = async (
  sheets: SheetsClient,
  options: { dryRun: boolean; limit: number; today?: string; leadIds?: string[] }
): Promise<RecheckResult[]> => {
  const today = options.today ?? todayInTokyo();
  const [table, settings, reacted] = await Promise.all([
    readSalesManagementTable(sheets),
    readResendSettings(sheets),
    readReactedLeadIds(sheets)
  ]);
  const results: RecheckResult[] = [];

  const due = table.leads
    .filter((lead) => lead.status === "見送り" && !reacted.has(lead.leadId) && lead.officialSiteUrl)
    .filter((lead) => !options.leadIds || options.leadIds.includes(lead.leadId))
    .map((lead) => ({ lead, last: lastCheckedDate(lead.memo) }))
    .filter(({ last }) => !last || daysBetween(last, today) >= settings.recheckIntervalDays)
    // 確認日が古い（または未確認の）ものから先に確認する
    .sort((a, b) => a.last.localeCompare(b.last))
    .slice(0, options.limit);

  for (const [index, { lead }] of due.entries()) {
    if (index > 0) {
      await pause(1000);
    }

    const assessment = await assessLead(lead);
    const wasSiteDown = SITE_DOWN_MEMO_PATTERN.test(lead.memo);
    const newContact = Boolean(assessment.foundFormUrl || assessment.foundEmail);
    const revive = assessment.sendable && (newContact || wasSiteDown);
    let line: string;

    if (revive) {
      const contact = assessment.foundEmail || assessment.foundFormUrl || lead.emailAddress || lead.contactFormUrl;
      line = `${RECHECK_LINE_PREFIX}${newContact ? "連絡先を確認できたため" : "サイトを開けるようになったため"}送信待ちに変更 (${today}) ${contact}`;
    } else if (assessment.sendable) {
      line = `${RECHECK_LINE_PREFIX}${today} 確認。公式サイトと連絡先は確認できたが、見送りの理由が残っているため見送りのまま`;
    } else {
      line = `${RECHECK_LINE_PREFIX}${today} 確認。見送りのまま（${assessment.reason}）`;
    }

    if (!options.dryRun) {
      if (revive) {
        if (assessment.foundEmail) {
          await sheets.updateValues(fieldRangeForRow(table.columns, "emailAddress", lead.rowNumber), [[assessment.foundEmail]]);
          await sheets.updateValues(fieldRangeForRow(table.columns, "contactMethod", lead.rowNumber), [["メール"]]);
        } else if (assessment.foundFormUrl) {
          await sheets.updateValues(fieldRangeForRow(table.columns, "contactFormUrl", lead.rowNumber), [[assessment.foundFormUrl]]);
          await sheets.updateValues(fieldRangeForRow(table.columns, "contactMethod", lead.rowNumber), [["フォーム"]]);
        }

        if (!newContact && lead.contactMethod === "未定") {
          await sheets.updateValues(fieldRangeForRow(table.columns, "contactMethod", lead.rowNumber), [[lead.emailAddress ? "メール" : "フォーム"]]);
        }

        await sheets.updateValues(statusRangeForRow(table.columns, lead.rowNumber), [["送信待ち"]]);
      }

      await sheets.updateValues(fieldRangeForRow(table.columns, "memo", lead.rowNumber), [[replaceRecheckLine(lead.memo, line)]]);
    }

    results.push({
      leadId: lead.leadId,
      companyName: lead.companyName,
      outcome: revive ? "revived" : "unchanged",
      detail: line.replace(RECHECK_LINE_PREFIX, "")
    });
  }

  return results;
};
