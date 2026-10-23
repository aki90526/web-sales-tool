"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, CheckCircle2, Copy, FileText, Filter, LayoutGrid, List, Mail, MessageSquare, MousePointerClick, Pencil, RefreshCw, Sparkles, Users, X } from "lucide-react";
import UndoToast, { type UndoToastData } from "../components/UndoToast";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";
import LeadCards, { type CardNotice } from "./LeadCards";
import { STATUSES } from "../../src/domain/lead";

type Lead = {
  rowNumber: number;
  leadId: string;
  companyName: string;
  leadType: string;
  industry: string;
  region: string;
  officialSiteUrl: string;
  contactMethod: string;
  contactFormUrl: string;
  emailAddress: string;
  salesScore: number;
  status: string;
  lastApproachDate: string;
  nextActionDate: string;
  memo: string;
};

const ALL = "すべて";
const CARD_PAGE_SIZE = 60;

const autoResizeTextarea = (el: HTMLTextAreaElement | null): void => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const canSendEmail = (lead: { status: string; contactMethod: string; emailAddress: string }): boolean =>
  lead.status === "送信待ち" && lead.contactMethod === "メール" && isValidEmail(lead.emailAddress);

const canAutoFill = (lead: { status: string; contactMethod: string; contactFormUrl: string }): boolean =>
  lead.status === "送信待ち" && lead.contactMethod === "フォーム" && /^https?:\/\//i.test(lead.contactFormUrl);

const leadIdSortValue = (leadId: string): number => {
  const match = /^L-(\d+)$/.exec(leadId);
  return match ? Number(match[1]) : -1;
};

const statusClass = (status: string): string => {
  if (status === "送信待ち") return "status-badge waiting";
  if (status === "送信済み") return "status-badge sent";
  if (status === "返信あり") return "status-badge reply";
  if (status === "面談済み") return "status-badge interviewed";
  if (status === "保留") return "status-badge onhold";
  return "status-badge";
};

const methodClass = (method: string): string => {
  if (method === "メール") return "method-badge email";
  if (method === "フォーム") return "method-badge form";
  return "method-badge";
};

const rowClass = (status: string): string => {
  if (status === "送信済み") return "row-sent";
  if (status === "見送り") return "row-skip";
  if (status === "除外") return "row-excluded";
  return "";
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [leadTypeFilter, setLeadTypeFilter] = useState(ALL);
  const [autoRecordedLeadIds, setAutoRecordedLeadIds] = useState<Set<string>>(new Set());
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [messageModal, setMessageModal] = useState<{ leadId: string; companyName: string } | null>(null);
  const [messageContent, setMessageContent] = useState<{ subject: string; body: string } | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [markSentLeadId, setMarkSentLeadId] = useState<string | null>(null);
  const [focusLeadId, setFocusLeadId] = useState<string | null>(null);
  const [highlightedLeadId, setHighlightedLeadId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  // 一覧の表示形式（リスト／カード）。次回も同じ形式で開く
  const [viewMode, setViewMode] = useState<"list" | "card">("list");
  const [cardLimit, setCardLimit] = useState(CARD_PAGE_SIZE);
  const [runningLeadId, setRunningLeadId] = useState<string | null>(null);
  const [cardNotices, setCardNotices] = useState<Record<string, CardNotice>>({});
  // ステータスを変えた直後の「元に戻す」通知
  const [undoToast, setUndoToast] = useState<UndoToastData | null>(null);
  const undoInfo = useRef<
    | { kind: "status"; leadId: string; previousStatus: string; historyLine: string }
    | { kind: "email"; leadId: string; restore: { email: string; contactMethod: string; status: string }; removeLine: string }
    | { kind: "formUrl"; leadId: string; restore: { contactFormUrl: string; contactMethod: string; status: string }; removeLine: string }
    | null
  >(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("leads-view-mode") === "card") {
        setViewMode("card");
      }
    } catch {
      // 保存できない環境では、リスト表示のまま使う
    }
  }, []);

  const changeViewMode = (mode: "list" | "card") => {
    setViewMode(mode);
    try {
      window.localStorage.setItem("leads-view-mode", mode);
    } catch {
      // 保存できなくても表示は切り替わる
    }
  };

  useEffect(() => {
    setFocusLeadId(new URLSearchParams(window.location.search).get("leadId"));
  }, []);

  useEffect(() => {
    fetch("/api/form-watch", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        const entries: Array<{ leadId: string; state: string }> = Array.isArray(body.entries) ? body.entries : [];
        setAutoRecordedLeadIds(new Set(entries.filter((entry) => entry.state === "recorded").map((entry) => entry.leadId)));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!leads || !focusLeadId) return;

    // リスト表示は行、カード表示はカードへスクロールする
    const row = viewMode === "card" ? document.getElementById(`lead-card-${focusLeadId}`) : rowRefs.current[focusLeadId];
    if (!row) return;

    row.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedLeadId(focusLeadId);
    const timer = setTimeout(() => setHighlightedLeadId(null), 5000);

    return () => clearTimeout(timer);
  }, [leads, focusLeadId, viewMode]);

  const fetchLeads = async (): Promise<Lead[]> => {
    const res = await fetch("/api/leads");
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.message ?? `HTTP ${res.status}`);
    }
    return body.leads as Lead[];
  };

  const loadLeads = () => {
    setError(null);
    setLeads(null);
    fetchLeads()
      .then((data) => setLeads(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "読み込みに失敗しました"));
  };

  const refreshLeadsQuietly = async () => {
    try {
      const data = await fetchLeads();
      setLeads(data);
    } catch {
      // 一覧の再取得のみのため、失敗しても既存表示を維持する
    }
  };

  useEffect(() => {
    loadLeads();
  }, []);

  const updateMemo = async (lead: Lead, nextMemo: string) => {
    if (nextMemo === lead.memo) return;

    const previousMemo = lead.memo;
    setStatusError(null);
    setLeads((current) =>
      current
        ? current.map((entry) => (entry.leadId === lead.leadId ? { ...entry, memo: nextMemo } : entry))
        : current
    );

    try {
      const res = await fetch("/api/leads/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.leadId, memo: nextMemo })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setLeads((current) =>
        current
          ? current.map((entry) => (entry.leadId === lead.leadId ? { ...entry, memo: previousMemo } : entry))
          : current
      );
      setStatusError(err instanceof Error ? err.message : "メモの更新に失敗しました");
    }
  };

  // メールアドレスを登録・変更する（サイトの画像で貼られていたアドレスを見つけた場合など）。
  // 送信前のフォーム・未定のリードは、連絡方法がメールになり、「連絡先なし」で見送りだったリードは、送信待ちに戻る
  const editEmail = async (lead: Lead) => {
    const input = window.prompt(`${lead.companyName}（${lead.leadId}）のメールアドレス`, lead.emailAddress);
    if (input === null) return;

    const nextEmail = input.trim();
    if (nextEmail === lead.emailAddress) return;

    if (!isValidEmail(nextEmail)) {
      setStatusError("メールアドレスの形式が正しくありません");
      return;
    }

    setStatusError(null);

    try {
      const res = await fetch("/api/leads/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.leadId, email: nextEmail })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }

      setLeads((current) =>
        current
          ? current.map((entry) =>
              entry.leadId === lead.leadId
                ? { ...entry, emailAddress: body.emailAddress, contactMethod: body.contactMethod, status: body.status, memo: body.memo ?? entry.memo }
                : entry
            )
          : current
      );

      if (body.historyLine) {
        undoInfo.current = { kind: "email", leadId: lead.leadId, restore: body.previous, removeLine: body.historyLine };
        setUndoToast({ key: Date.now(), message: `${lead.leadId} ${lead.companyName} のメールアドレスを登録しました（${body.contactMethod} / ${body.status}）` });
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "メールアドレスの更新に失敗しました");
    }
  };

  const editFormUrl = async (lead: Lead) => {
    const input = window.prompt(`${lead.companyName}（${lead.leadId}）のフォームURL`, lead.contactFormUrl);
    if (input === null) return;

    const nextUrl = input.trim();
    if (nextUrl === lead.contactFormUrl) return;

    setStatusError(null);

    try {
      const res = await fetch("/api/leads/form-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.leadId, contactFormUrl: nextUrl })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }

      setLeads((current) =>
        current
          ? current.map((entry) =>
              entry.leadId === lead.leadId
                ? {
                    ...entry,
                    contactFormUrl: body.contactFormUrl,
                    contactMethod: body.contactMethod ?? entry.contactMethod,
                    status: body.status ?? entry.status,
                    memo: body.memo ?? entry.memo
                  }
                : entry
            )
          : current
      );

      // 連絡方法・ステータスが変わった（未定からフォームになった）ときは、「元に戻す」を出す
      if (body.historyLine && (body.contactMethod !== lead.contactMethod || body.status !== lead.status)) {
        undoInfo.current = { kind: "formUrl", leadId: lead.leadId, restore: body.previous, removeLine: body.historyLine };
        setUndoToast({ key: Date.now(), message: `${lead.leadId} ${lead.companyName} のフォームURLを登録しました（${body.contactMethod} / ${body.status}）` });
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "フォームURLの更新に失敗しました");
    }
  };

  const updateStatus = async (lead: Lead, nextStatus: string) => {
    if (nextStatus === lead.status) return;

    // フォームのリードを「送信済み」にするときは、送信の記録（アプローチ履歴）も残すかを確認する。
    // 履歴がないと、月別のグラフや返信の検知の対象にならない
    if (nextStatus === "送信済み" && lead.contactMethod === "フォーム" && /^https?:\/\//i.test(lead.contactFormUrl)) {
      const withHistory = window.confirm(
        `${lead.companyName}（${lead.leadId}）を「送信済み」にします。\n\nOK: 送信の記録（アプローチ履歴）も残す（おすすめ）\nキャンセル: ステータスだけ変更する（グラフや返信の検知の対象になりません）`
      );

      if (withHistory) {
        await markFormSent(lead, "リード一覧のステータス変更から記録", true);
        return;
      }
    }

    const previousStatus = lead.status;
    setStatusError(null);
    setUpdatingLeadId(lead.leadId);
    setLeads((current) =>
      current
        ? current.map((entry) => (entry.leadId === lead.leadId ? { ...entry, status: nextStatus } : entry))
        : current
    );

    try {
      const res = await fetch("/api/leads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.leadId, status: nextStatus })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }

      // 変更の履歴がメモに追記されるので、画面のメモも更新し、「元に戻す」を出す
      setLeads((current) =>
        current ? current.map((entry) => (entry.leadId === lead.leadId ? { ...entry, memo: body.memo ?? entry.memo } : entry)) : current
      );

      if (body.historyLine && (STATUSES as readonly string[]).includes(previousStatus)) {
        undoInfo.current = { kind: "status", leadId: lead.leadId, previousStatus, historyLine: body.historyLine };
        setUndoToast({ key: Date.now(), message: `${lead.leadId} ${lead.companyName} を「${nextStatus}」にしました` });
      }
    } catch (err) {
      setLeads((current) =>
        current
          ? current.map((entry) => (entry.leadId === lead.leadId ? { ...entry, status: previousStatus } : entry))
          : current
      );
      setStatusError(err instanceof Error ? err.message : "ステータスの更新に失敗しました");
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const undoStatusChange = async () => {
    const info = undoInfo.current;
    setUndoToast(null);
    if (!info) return;

    try {
      if (info.kind === "formUrl") {
        const res = await fetch("/api/leads/form-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: info.leadId, restore: info.restore, removeLine: info.removeLine })
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        setLeads((current) =>
          current
            ? current.map((entry) =>
                entry.leadId === info.leadId
                  ? { ...entry, contactFormUrl: body.contactFormUrl, contactMethod: body.contactMethod, status: body.status, memo: body.memo ?? entry.memo }
                  : entry
              )
            : current
        );
      } else if (info.kind === "email") {
        const res = await fetch("/api/leads/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: info.leadId, restore: info.restore, removeLine: info.removeLine })
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        setLeads((current) =>
          current
            ? current.map((entry) =>
                entry.leadId === info.leadId
                  ? { ...entry, emailAddress: body.emailAddress, contactMethod: body.contactMethod, status: body.status, memo: body.memo ?? entry.memo }
                  : entry
              )
            : current
        );
      } else {
        const res = await fetch("/api/leads/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: info.leadId, status: info.previousStatus, removeLine: info.historyLine })
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        setLeads((current) =>
          current
            ? current.map((entry) => (entry.leadId === info.leadId ? { ...entry, status: info.previousStatus, memo: body.memo ?? entry.memo } : entry))
            : current
        );
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "元に戻せませんでした");
    }

    undoInfo.current = null;
  };

  // フォーム送信を記録する（アプローチ履歴に1行追加し、ステータスを「送信済み」にする）。
  // 「送信待ち」以外のリードでも、確認のうえ、記録できる
  const markFormSent = async (lead: Lead, note = "リード一覧から手動フォーム送信済み", skipConfirm = false) => {
    if (!skipConfirm) {
      const statusNote = lead.status === "送信待ち" ? "" : `\n（今のステータスは「${lead.status || "未設定"}」です）`;
      const confirmed = window.confirm(`${lead.companyName}（${lead.leadId}）をフォーム送信済みにして、アプローチ履歴に記録しますか？${statusNote}`);
      if (!confirmed) return;
    }

    setStatusError(null);
    setMarkSentLeadId(lead.leadId);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "forms-mark-sent",
          leadId: lead.leadId,
          note,
          confirm: true,
          force: true
        })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      if (body.job?.status === "failed") {
        throw new Error((body.job.stderr || body.job.stdout || "処理に失敗しました").trim().split("\n").filter(Boolean).slice(-1)[0]);
      }
      await refreshLeadsQuietly();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "フォーム送信済みの更新に失敗しました");
    } finally {
      setMarkSentLeadId(null);
    }
  };

  const setNotice = (leadId: string, notice: CardNotice | null) => {
    setCardNotices((current) => {
      const next = { ...current };
      if (notice) {
        next[leadId] = notice;
      } else {
        delete next[leadId];
      }
      return next;
    });
  };

  type JobResult = {
    status: "success" | "failed";
    stdout?: string;
    stderr?: string;
    resultCount?: number;
    fillWarnings?: Array<{ leadId: string; message: string }>;
    captchaDetections?: Array<{ leadId: string; label: string }>;
    confirmedLeadIds?: string[];
  };

  // メール送信・フォーム自動入力などの実行を、サーバーに依頼する（実行中は他の実行ボタンを止める）
  const runLeadJob = async (lead: Lead, payload: Record<string, unknown>): Promise<JobResult | null> => {
    setNotice(lead.leadId, null);
    setRunningLeadId(lead.leadId);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.leadId, ...payload })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      return body.job as JobResult;
    } catch (err) {
      setNotice(lead.leadId, { status: "failed", text: err instanceof Error ? err.message : "実行に失敗しました" });
      return null;
    } finally {
      setRunningLeadId(null);
    }
  };

  const lastLine = (job: JobResult): string =>
    (job.stderr || job.stdout || "").trim().split("\n").filter(Boolean).slice(-1)[0] ?? "原因不明です";

  const sendEmailToLead = async (lead: Lead) => {
    const confirmed = window.confirm(
      `${lead.companyName}（${lead.leadId}）へメールを送信します。\n宛先: ${lead.emailAddress}\n\n送信すると取り消せません。よろしいですか？`
    );
    if (!confirmed) return;

    const job = await runLeadJob(lead, { command: "email-send", confirm: true });
    if (!job) return;

    if (job.status === "failed") {
      setNotice(lead.leadId, { status: "failed", text: `送信に失敗しました: ${lastLine(job)}` });
    } else if ((job.resultCount ?? 0) >= 1) {
      setNotice(lead.leadId, { status: "success", text: "メールを送信しました。ステータスを「送信済み」に更新しました。" });
    } else {
      setNotice(lead.leadId, {
        status: "failed",
        text: "送信されませんでした。送信直前の確認で対象外になった可能性があります（ステータス・宛先・次回対応日を確認してください）。"
      });
    }

    await refreshLeadsQuietly();
  };

  const autoFillLead = async (lead: Lead) => {
    const job = await runLeadJob(lead, { command: "forms-fill" });
    if (!job) return;

    if (job.status === "failed") {
      setNotice(lead.leadId, { status: "failed", text: `自動入力に失敗しました: ${lastLine(job)}` });
      return;
    }

    const warnings = (job.fillWarnings ?? []).filter((warning) => warning.leadId === lead.leadId).map((warning) => warning.message);
    const captcha = (job.captchaDetections ?? []).find((detection) => detection.leadId === lead.leadId);
    const advanced = (job.confirmedLeadIds ?? []).includes(lead.leadId);
    const parts = [
      advanced
        ? "Chromeで確認画面まで進みました。内容を確認して、送信してください。送信完了を検知すると、自動で「送信済み」になります。"
        : "Chromeで入力しました。内容を確認して、送信してください。送信完了を検知すると、自動で「送信済み」になります。",
      ...(captcha ? [`${captcha.label} があるため、自動送信できない可能性があります。手動入力もご検討ください。`] : []),
      ...warnings
    ];

    setNotice(lead.leadId, { status: warnings.length > 0 || captcha ? "failed" : "success", text: parts.join(" / ") });
    await refreshLeadsQuietly();
  };

  // 件名・本文を表示し、フォームを新しいタブで開く
  const manualFillLead = (lead: Lead) => {
    if (/^https?:\/\//i.test(lead.contactFormUrl)) {
      window.open(lead.contactFormUrl, "_blank", "noopener,noreferrer");
    }
    void openMessage(lead);
  };

  const openMessage = async (lead: Lead) => {
    setMessageModal({ leadId: lead.leadId, companyName: lead.companyName });
    setMessageContent(null);
    setMessageError(null);
    setMessageLoading(true);
    setCopied(false);

    try {
      const res = await fetch(`/api/leads/message?leadId=${encodeURIComponent(lead.leadId)}`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setMessageContent({ subject: body.subject, body: body.body });
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : "メッセージの取得に失敗しました");
    } finally {
      setMessageLoading(false);
    }
  };

  const closeMessage = () => {
    setMessageModal(null);
    setMessageContent(null);
    setMessageError(null);
  };

  const copyMessage = async () => {
    if (!messageContent) return;
    const text = `${messageContent.subject}\n\n${messageContent.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessageError("コピーに失敗しました。手動で選択してコピーしてください。");
    }
  };

  const statuses = useMemo(() => {
    if (!leads) return [ALL];
    return [ALL, ...Array.from(new Set(leads.map((lead) => lead.status).filter(Boolean)))];
  }, [leads]);

  const leadTypes = useMemo(() => {
    if (!leads) return [ALL];
    return [ALL, ...Array.from(new Set(leads.map((lead) => lead.leadType).filter(Boolean)))];
  }, [leads]);

  const filtered = useMemo(() => {
    if (!leads) return [];
    return leads
      .filter((lead) => statusFilter === ALL || lead.status === statusFilter)
      .filter((lead) => leadTypeFilter === ALL || lead.leadType === leadTypeFilter)
      .sort((a, b) => leadIdSortValue(b.leadId) - leadIdSortValue(a.leadId));
  }, [leads, statusFilter, leadTypeFilter]);

  const stats = useMemo(() => {
    const source = leads ?? [];
    return {
      total: source.length,
      email: source.filter((lead) => lead.contactMethod === "メール").length,
      form: source.filter((lead) => lead.contactMethod === "フォーム").length,
      waiting: source.filter((lead) => lead.status === "送信待ち").length
    };
  }, [leads]);

  // 「操作」メニューの項目（メール送信・フォーム自動入力・フォーム手動入力など）
  const menuItemsFor = (lead: Lead): ActionMenuItem[] => {
    const busy = runningLeadId !== null;
    const items: ActionMenuItem[] = [];

    if (lead.contactMethod === "メール") {
      items.push({
        key: "email",
        label: "メール送信",
        icon: <Mail size={15} />,
        primary: true,
        disabled: !canSendEmail(lead) || busy,
        hint: busy ? "別の処理が実行中です" : "「送信待ち」で、メールアドレスが正しいときだけ送信できます",
        onClick: () => void sendEmailToLead(lead)
      });
    }

    if (lead.contactMethod === "フォーム") {
      items.push(
        {
          key: "autofill",
          label: "フォーム自動入力",
          icon: <Sparkles size={15} />,
          primary: true,
          disabled: !canAutoFill(lead) || busy,
          hint: busy ? "別の処理が実行中です" : "「送信待ち」で、フォームURLがあるときだけ使えます",
          onClick: () => void autoFillLead(lead)
        },
        {
          key: "manual",
          label: "フォーム手動入力",
          icon: <MousePointerClick size={15} />,
          disabled: !/^https?:\/\//i.test(lead.contactFormUrl),
          hint: "フォームURLがありません",
          onClick: () => manualFillLead(lead)
        },
        {
          key: "mark-sent",
          label: "フォーム送信済みにする",
          icon: <CheckCircle2 size={15} />,
          disabled: markSentLeadId === lead.leadId || busy,
          hint: "処理中です",
          onClick: () => void markFormSent(lead)
        }
      );
    }

    // 連絡先の登録・変更（登録済みなら変更、未登録なら登録として使える）
    items.push(
      {
        key: "edit-email",
        label: lead.emailAddress ? "メールアドレスを変更" : "メールアドレスを登録",
        icon: lead.emailAddress ? <Pencil size={15} /> : <Mail size={15} />,
        onClick: () => void editEmail(lead)
      },
      {
        key: "edit-form-url",
        label: lead.contactFormUrl ? "フォームURLを変更" : "フォームURLを登録",
        icon: lead.contactFormUrl ? <Pencil size={15} /> : <FileText size={15} />,
        onClick: () => void editFormUrl(lead)
      }
    );

    items.push({ key: "message", label: "メッセージを見る", icon: <MessageSquare size={15} />, onClick: () => void openMessage(lead) });

    return items;
  };

  if (error) {
    return <p className="error-box">読み込みエラー: {error}</p>;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <h2>リード一覧</h2>
          <p>営業管理シートのリードを確認・絞り込みできます。</p>
        </div>
        <button className="btn secondary" onClick={loadLeads}>
          <RefreshCw size={16} />
          更新
        </button>
      </div>

      {statusError && <p className="error-box">更新エラー: {statusError}</p>}

      <section className="kpi-grid">
        <article className="kpi-card">
          <div className="kpi-card-head">
            <span>全リード</span>
            <span className="kpi-icon"><Users size={18} /></span>
          </div>
          <div className="kpi-value">{stats.total}</div>
          <span className="kpi-note">表示対象</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#2f6df6", "--card-bg": "#dbeafe" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>メール</span>
            <span className="kpi-icon"><Mail size={18} /></span>
          </div>
          <div className="kpi-value">{stats.email}</div>
          <span className="kpi-note">送信候補</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#f59e0b", "--card-bg": "#fef3c7" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>フォーム</span>
            <span className="kpi-icon"><MousePointerClick size={18} /></span>
          </div>
          <div className="kpi-value">{stats.form}</div>
          <span className="kpi-note">手動確認</span>
        </article>
        <article className="kpi-card" style={{ "--card-color": "#10b981", "--card-bg": "#d1fae5" } as CSSProperties}>
          <div className="kpi-card-head">
            <span>送信待ち</span>
            <span className="kpi-icon"><Filter size={18} /></span>
          </div>
          <div className="kpi-value">{stats.waiting}</div>
          <span className="kpi-note">次に対応</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3 className="panel-title">リード</h3>
            <p className="panel-caption">{filtered.length}件を表示しています。</p>
          </div>
          <div className="btn-row">
            <div className="field view-field">
              表示形式
              <div className="view-toggle" role="group" aria-label="表示形式">
                <button type="button" className={`btn secondary${viewMode === "list" ? " active" : ""}`} aria-pressed={viewMode === "list"} onClick={() => changeViewMode("list")}>
                  <List size={15} />
                  リスト
                </button>
                <button type="button" className={`btn secondary${viewMode === "card" ? " active" : ""}`} aria-pressed={viewMode === "card"} onClick={() => changeViewMode("card")}>
                  <LayoutGrid size={15} />
                  カード
                </button>
              </div>
            </div>
            <label className="field">
              ステータス
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              営業先種別
              <select value={leadTypeFilter} onChange={(event) => setLeadTypeFilter(event.target.value)}>
                {leadTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {!leads ? (
          <p className="panel-caption">読み込み中...</p>
        ) : viewMode === "card" ? (
          <>
            <LeadCards
              leads={filtered.slice(0, cardLimit)}
              highlightedLeadId={highlightedLeadId}
              busy={runningLeadId !== null}
              runningLeadId={runningLeadId}
              updatingLeadId={updatingLeadId}
              notices={cardNotices}
              statusClass={statusClass}
              methodClass={methodClass}
              onStatusChange={updateStatus}
              onMemoSave={updateMemo}
              onEditFormUrl={editFormUrl}
              onEditEmail={editEmail}
              onShowMessage={openMessage}
              onSendEmail={sendEmailToLead}
              onAutoFill={autoFillLead}
              onManualFill={manualFillLead}
              onMarkFormSent={markFormSent}
            />
            {filtered.length > cardLimit && (
              <div className="btn-row mt-4">
                <button className="btn secondary" type="button" onClick={() => setCardLimit((current) => current + CARD_PAGE_SIZE)}>
                  さらに表示（残り{filtered.length - cardLimit}件）
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="hide-mobile cell-nowrap">リードID</th>
                  <th className="col-fixed-180">企業名</th>
                  <th className="hide-mobile">種別</th>
                  <th className="hide-mobile col-fixed-120">地域</th>
                  <th className="hide-mobile">連絡方法</th>
                  <th>スコア</th>
                  <th>ステータス</th>
                  <th className="col-memo">メモ</th>
                  <th className="cell-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <Fragment key={lead.leadId}>
                    <tr
                      ref={(el) => {
                        rowRefs.current[lead.leadId] = el;
                      }}
                      className={`${rowClass(lead.status)}${highlightedLeadId === lead.leadId ? " row-highlight" : ""}`}
                    >
                      <td className="hide-mobile cell-nowrap">{lead.leadId}</td>
                      <td className="col-fixed-180">
                        <div className="clamp-2" title={lead.companyName}>
                          {lead.officialSiteUrl ? (
                            <a className="text-[var(--accent)] hover:underline" href={lead.officialSiteUrl} target="_blank" rel="noreferrer">
                              {lead.companyName}
                            </a>
                          ) : (
                            lead.companyName
                          )}
                        </div>
                      </td>
                      <td className="hide-mobile cell-nowrap">{lead.leadType}</td>
                      <td className="hide-mobile col-fixed-120">
                        <div className="clamp-2" title={lead.region}>
                          {lead.region}
                        </div>
                      </td>
                      <td className="hide-mobile">
                        {/* 連絡方法は、想定する連絡方法（メール・フォーム）か、未定だけを表示する。登録済みのものは、鉛筆で変更できる。
                            登録・変更は、操作メニューからもできる */}
                        <div className="btn-row-tight">
                          {lead.contactMethod === "フォーム" && lead.contactFormUrl ? (
                            <a className={methodClass(lead.contactMethod)} href={lead.contactFormUrl} target="_blank" rel="noreferrer" title={lead.contactFormUrl}>
                              {lead.contactMethod}
                            </a>
                          ) : (
                            <span className={methodClass(lead.contactMethod)} title={lead.contactMethod === "メール" ? lead.emailAddress : undefined}>
                              {lead.contactMethod || "未設定"}
                            </span>
                          )}
                          {lead.contactMethod === "メール" && lead.emailAddress && (
                            <button
                              className="btn secondary icon-tiny"
                              type="button"
                              onClick={() => editEmail(lead)}
                              title={`メールアドレスを変更（${lead.emailAddress}）`}
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                          {lead.contactMethod === "フォーム" && lead.contactFormUrl && (
                            <button
                              className="btn secondary icon-tiny"
                              type="button"
                              onClick={() => editFormUrl(lead)}
                              title={`フォームURLを変更（${lead.contactFormUrl}）`}
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td><span className="score-badge">{lead.salesScore}</span></td>
                      <td>
                        {autoRecordedLeadIds.has(lead.leadId) && lead.status === "送信済み" && (
                          <span className="status-badge sent" title="送信完了画面を検知して自動で更新しました">自動記録</span>
                        )}
                        <select
                          className={`${statusClass(lead.status)} status-select`}
                          aria-label={`${lead.leadId} のステータス`}
                          value={STATUSES.includes(lead.status as (typeof STATUSES)[number]) ? lead.status : ""}
                          disabled={updatingLeadId === lead.leadId}
                          onChange={(event) => updateStatus(lead, event.target.value)}
                        >
                          {!STATUSES.includes(lead.status as (typeof STATUSES)[number]) && (
                            <option value="">{lead.status || "未設定"}</option>
                          )}
                          {STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="col-memo">
                        <textarea
                          key={lead.memo}
                          ref={autoResizeTextarea}
                          className="memo-input"
                          rows={1}
                          defaultValue={lead.memo}
                          placeholder="メモを入力"
                          onInput={(event) => autoResizeTextarea(event.currentTarget)}
                          onBlur={(event) => updateMemo(lead, event.target.value)}
                        />
                      </td>
                      <td className="cell-nowrap">
                        <ActionMenu items={menuItemsFor(lead)} />
                      </td>
                    </tr>
                    {cardNotices[lead.leadId] && (
                      <tr>
                        <td colSpan={9}>
                          <p className={cardNotices[lead.leadId].status === "success" ? "success-box" : "error-box"}>
                            {lead.leadId} {lead.companyName}: {cardNotices[lead.leadId].text}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <UndoToast toast={undoToast} onUndo={undoStatusChange} onClose={() => setUndoToast(null)} />

      {messageModal && (
        <div className="modal-backdrop" onClick={closeMessage}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="panel-title">{messageModal.companyName}</h3>
                <p className="panel-caption">{messageModal.leadId} 宛のメッセージ</p>
              </div>
              <button className="btn secondary icon-only" type="button" onClick={closeMessage} title="閉じる">
                <X size={16} />
              </button>
            </div>

            {messageLoading && <p className="panel-caption">読み込み中...</p>}
            {messageError && <p className="error-box">{messageError}</p>}

            {messageContent && (
              <>
                <label className="field full">
                  件名
                  <input value={messageContent.subject} readOnly />
                </label>
                <label className="field full mt-4">
                  本文
                  <textarea className="memo-input modal-body-text" value={messageContent.body} readOnly rows={16} />
                </label>
                <div className="btn-row mt-4">
                  <button className="btn primary" type="button" onClick={copyMessage}>
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "コピーしました" : "件名・本文をコピー"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
