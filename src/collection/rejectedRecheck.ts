import { createHash } from "crypto";
import { daysBetween, readResendSettings, todayInTokyo } from "../domain/resend";
import { SHEETS } from "../domain/lead";
import { lastCheckedDate } from "../domain/recheckSchedule";
import { clearRecheckDays, parseRecheckSetting } from "../domain/skipTracking";
import { detectSalesForbidden } from "../domain/salesForbiddenDetection";
import { fieldRangeForRow, readSalesManagementTable, SalesManagementLead, statusRangeForRow } from "../google/salesManagementRepository";
import { SheetsClient } from "../google/sheetsClient";
import { LeadCandidate } from "../openai/leadCandidateCollector";
import { BROWSER_FETCH_OPTIONS, fetchPage, htmlToText } from "./companyNameVerifier";
import { checkFormPresence, excludeRequestOnlyForm, isRequestOnlyForm, verifyContactUrl } from "./contactUrlVerifier";
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
  options: { dryRun: boolean; limit: number; today?: string; leadIds?: string[]; baselineOnly?: boolean }
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
    .map((lead) => ({ lead, last: lastCheckedDate(lead.memo), setting: parseRecheckSetting(lead.recheckDays) }))
    .filter(({ setting }) => setting.kind !== "never")
    .filter(({ last, setting }) => {
      const interval = setting.kind === "days" ? setting.days : settings.recheckIntervalDays;
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
      const baselineLine = `${RECHECK_LINE_PREFIX}${today} 確認。見送りのまま（フォームの状態を記録）${fingerprint ? ` [フォーム指紋:${fingerprint}]` : ""}`;

      if (!options.dryRun) {
        await sheets.updateValues(fieldRangeForRow(table.columns, "memo", lead.rowNumber), [[replaceRecheckLine(lead.memo, baselineLine)]]);
      }

      results.push({ leadId: lead.leadId, companyName: lead.companyName, outcome: "unchanged", detail: baselineLine.replace(RECHECK_LINE_PREFIX, "") });
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
      const stored = readStoredFingerprint(lead.memo);

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
      line = `${RECHECK_LINE_PREFIX}${changed}送信待ちに変更 (${today}) ${contact}`;
    } else {
      line = `${RECHECK_LINE_PREFIX}${today} 確認。見送りのまま（${skipReason}）${fingerprint ? ` [フォーム指紋:${fingerprint}]` : ""}`;
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
