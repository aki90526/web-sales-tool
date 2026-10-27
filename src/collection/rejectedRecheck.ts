import { createHash } from "crypto";
import { daysBetween, readResendSettings, todayInTokyo } from "../domain/resend";
import { SHEETS } from "../domain/lead";
import { appendLeadLog, LeadLogEntry, readAllLeadLogs, recheckStateFromLog, skipCountFromLog } from "../domain/leadLog";
import { lastCheckedDate } from "../domain/recheckSchedule";
import { clearRecheckDays, parseRecheckSetting } from "../domain/skipTracking";
import { detectSalesForbidden } from "../domain/salesForbiddenDetection";
import { fieldRangeForRow, readSalesManagementTable, SalesManagementLead, statusRangeForRow } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";
import { LeadCandidate } from "../openai/leadCandidateCollector";
import { BROWSER_FETCH_OPTIONS, fetchPage, htmlToText } from "./companyNameVerifier";
import { ARTICLE_PATH_PATTERN, checkFormPresence, excludeRequestOnlyForm, isRequestOnlyForm, verifyContactUrl } from "./contactUrlVerifier";
import { findEmailOnSite } from "./emailFinder";

// 「見送り」のリードを、一定の間隔で再確認する。
//  公式サイトが開く / 営業お断りの記載がない / 連絡先（メールかフォーム）がある / フォームが依頼・予約専用ではない、を満たせば「送信できる」と判断し、「送信待ち」に戻す。
//  ただし、メモに「フォームの不具合」（確認画面に反映されない、送信できない、など）が残っているリードは、同じフォームのまま戻すと同じ失敗をくり返すため、
//  フォームの構造（項目・送信先）の指紋を前回と比べる。変わっていれば（サイトが直された可能性があるので）戻し、同じなら見送りのままにする。
//  指紋が未記録のリードは、今回の状態を記録して、見送りのままにする（次回から比べる）。
//  間隔は、リードごとの「再確認までの日数」があればそれ、なければ設定シートの「見送り再確認間隔日数」。「なし」のリードは再確認しない。
//  「除外」と、返信のあったリードは対象外。

const RECHECK_LINE_PREFIX = "見送りの再確認:";
// メモに残る「フォームを試して失敗した」記録の言い回し（サイトの不具合・仕様で、サイトが直らない限り、同じ失敗になりやすいもの）
const FORM_FAILURE_NOTE_PATTERN =
  /(確認画面.{0,12}(反映|消え|表示されな)|反映されず|送信不可|送信できな|送信ボタン.{0,8}(反応|押せ|効かな)|重大なエラー|送信エラー|送信時.{0,6}エラー|項目なし|該当項目なし|フォーム.{0,6}不具合|入力内容が(消|リセット|反映))/;
const FINGERPRINT_PATTERN = /\[フォーム指紋:([0-9a-f]{6,16})\]/;

export const hasFormFailureNote = (memo: string): boolean => {
  // 再確認の記録（自動で書いた行）は、判定の対象にしない
  const body = memo
    .split("\n")
    .filter((line) => !line.startsWith("見送りの再確認:"))
    .join("\n");

  return FORM_FAILURE_NOTE_PATTERN.test(body);
};

const readStoredFingerprint = (memo: string): string => {
  const line = memo
    .split("\n")
    .filter((entry) => entry.startsWith("見送りの再確認:") && FINGERPRINT_PATTERN.test(entry))
    .pop();

  return line ? (FINGERPRINT_PATTERN.exec(line)?.[1] ?? "") : "";
};

// フォームの構造の指紋: <form> ごとの送信先のパスと、入力部品（種類と名前。値は含めない）を並べて、ハッシュにする。
// ページを取得できなければ空文字
export const formFingerprint = async (formUrl: string): Promise<string> => {
  let html: string;

  try {
    html = (await fetchPage(formUrl, 0, BROWSER_FETCH_OPTIONS)).text;
  } catch {
    return "";
  }

  const forms = Array.from(html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)).map((match) => {
    const action = /action\s*=\s*["']([^"']*)["']/i.exec(match[1])?.[1] ?? "";
    const path = action.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
    const controls = Array.from(match[2].matchAll(/<(input|textarea|select)\b([^>]*)>/gi))
      .map((control) => {
        const type = /type\s*=\s*["']?([a-z]+)/i.exec(control[2])?.[1]?.toLowerCase() ?? control[1].toLowerCase();
        const name = /name\s*=\s*["']([^"']*)["']/i.exec(control[2])?.[1] ?? "";
        return `${type}:${name}`;
      })
      .sort();

    return controls.length > 0 ? `${path}|${controls.join(",")}` : "";
  });

  const material = forms.filter(Boolean).sort().join("||") || "noform";
  return createHash("sha1").update(material).digest("hex").slice(0, 10);
};

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

const isArticleUrl = (url: string): boolean => {
  try {
    return Boolean(url) && ARTICLE_PATH_PATTERN.test(new URL(url).pathname);
  } catch {
    return false;
  }
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

  // 登録されているフォームURLが、お知らせ・ブログなどの記事ページのときは、フォームとは認めず、探し直す
  // （記事の中に、サイト検索などの <form> があるだけで、問い合わせフォームではないため）
  const registeredIsArticle = isArticleUrl(lead.contactFormUrl);

  if (lead.contactFormUrl && !registeredIsArticle) {
    const form = await assessForm(lead.contactFormUrl);
    return form.ok ? { sendable: true, reason: "" } : { sendable: false, reason: form.reason };
  }

  // 連絡先が未登録（または記事ページ）: 公式サイトから探す
  let candidate = registeredIsArticle ? { ...stubCandidate(lead), contactUrl: "" } : stubCandidate(lead);

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

  return { sendable: false, reason: registeredIsArticle ? "登録のフォームURLがお知らせ・ブログなどの記事ページで、問い合わせフォームを見つけられない" : "連絡先を見つけられない" };
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
  options: { dryRun: boolean; limit: number; today?: string; leadIds?: string[]; baselineOnly?: boolean }
): Promise<RecheckResult[]> => {
  const today = options.today ?? todayInTokyo();
  const [table, settings, reacted, allLogs] = await Promise.all([
    readSalesManagementTable(sheets),
    readResendSettings(sheets),
    readReactedLeadIds(sheets),
    readAllLeadLogs(sheets)
  ]);
  const results: RecheckResult[] = [];
  const logsByLead = new Map<string, LeadLogEntry[]>();

  allLogs.forEach((entry) => logsByLead.set(entry.leadId, [...(logsByLead.get(entry.leadId) ?? []), entry]));

  // 前回確認した日とフォームの指紋は、ログから読む（移行前のメモの記録も、念のため見る）
  const stateOf = (lead: { leadId: string; memo: string }): { last: string; fingerprint: string } => {
    const fromLog = recheckStateFromLog(logsByLead.get(lead.leadId) ?? []);
    const fromMemo = lastCheckedDate(lead.memo);

    return {
      last: fromLog.lastDate > fromMemo ? fromLog.lastDate : fromMemo,
      fingerprint: fromLog.fingerprint || readStoredFingerprint(lead.memo)
    };
  };

  const due = table.leads
    .filter((lead) => lead.status === "見送り" && !reacted.has(lead.leadId) && lead.officialSiteUrl)
    .filter((lead) => !options.leadIds || options.leadIds.includes(lead.leadId))
    .map((lead) => ({ lead, last: stateOf(lead).last, setting: parseRecheckSetting(lead.recheckDays), count: skipCountFromLog(logsByLead.get(lead.leadId) ?? [], lead.status) }))
    .filter(({ setting }) => setting.kind !== "never")
    .filter(({ last, setting, count }) => {
      // リードごとに期間を決めていなければ、1回目の見送りは「見送りの再確認」、2回目以降は「（2回目以降）」の日数
      const interval = setting.kind === "days" ? setting.days : count >= 2 ? settings.recheckLaterIntervalDays : settings.recheckIntervalDays;
      return !last || options.leadIds !== undefined || daysBetween(last, today) >= interval;
    })
    // 確認日が古い（または未確認の）ものから先に確認する
    .sort((a, b) => a.last.localeCompare(b.last))
    .slice(0, options.limit);

  for (const [index, { lead }] of due.entries()) {
    if (index > 0) {
      await pause(1000);
    }

    // 基準の記録だけ（ステータスは変えず、いまのフォームの指紋と確認日を残す。見送りにした直後に使う）
    if (options.baselineOnly) {
      const formUrl = lead.contactFormUrl;
      const fingerprint = formUrl ? await formFingerprint(formUrl) : "";
      const baselineText = `${today} 確認。見送りのまま（フォームの状態を記録）`;

      if (!options.dryRun) {
        await appendLeadLog(sheets, [
          { leadId: lead.leadId, kind: "再確認", text: baselineText, detail: fingerprint ? `フォーム指紋:${fingerprint}` : "" }
        ]);
      }

      results.push({ leadId: lead.leadId, companyName: lead.companyName, outcome: "unchanged", detail: baselineText });
      continue;
    }

    const assessment = await assessLead(lead);
    const newContact = Boolean(assessment.foundFormUrl || assessment.foundEmail);
    let revive = assessment.sendable;
    let skipReason = assessment.reason;
    let fingerprint = "";

    // フォームの不具合の記録があるリードは、フォームが変わったときだけ戻す
    const formUrl = assessment.foundFormUrl || (!lead.emailAddress && !assessment.foundEmail ? lead.contactFormUrl : "");

    if (revive && formUrl && !newContact && hasFormFailureNote(lead.memo)) {
      fingerprint = await formFingerprint(formUrl);
      const stored = stateOf(lead).fingerprint;

      if (fingerprint && (!stored || stored === fingerprint)) {
        revive = false;
        skipReason = stored
          ? "メモに残るフォームの不具合があり、フォームに変更がないため、同じ症状の可能性が高い"
          : "メモに残るフォームの不具合があるため、今回のフォームの状態を記録（次回から変更を比べる）";
      }
    }

    let line: string;

    if (revive) {
      const contact = assessment.foundEmail || assessment.foundFormUrl || lead.emailAddress || lead.contactFormUrl;
      const changed = fingerprint ? "フォームが変更されていたため" : newContact ? "連絡先を確認できたため" : "公式サイトと連絡先を確認できたため";
      line = `${changed}送信待ちに変更 (${today}) ${contact}`;
    } else {
      line = `${today} 確認。見送りのまま（${skipReason}）`;
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
        await clearRecheckDays(sheets, table, lead);
      }

      await appendLeadLog(sheets, [
        { leadId: lead.leadId, kind: "再確認", text: line, detail: fingerprint ? `フォーム指紋:${fingerprint}` : "" },
        ...(revive ? [{ leadId: lead.leadId, kind: "ステータス変更", text: "見送り → 送信待ち（見送りの再確認）" }] : [])
      ]);
    }

    results.push({
      leadId: lead.leadId,
      companyName: lead.companyName,
      outcome: revive ? "revived" : "unchanged",
      detail: line
    });
  }

  return results;
};
