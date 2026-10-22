"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  buildResultMessage,
  formatDateTime,
  jobStatusClass,
  LeadLink,
  outputText,
  statusLabel,
  watchStateLabel,
  type DashboardJob,
  type FormWatchEntry
} from "./shared";

type ResultDockProps = {
  // 直近に実行した処理（このページで実行したもの）
  job: DashboardJob | null;
  watchEntries: FormWatchEntry[];
  // 見張りの一覧を最初に読み込み終えたか（読み込み直後は、自動で開かない）
  watchLoaded: boolean;
  // 「ログ」（一覧）を開く
  onOpenLog?: () => void;
};

const latestEntry = (entries: FormWatchEntry[]): FormWatchEntry | null => {
  return entries.reduce<FormWatchEntry | null>((latest, entry) => (!latest || entry.updatedAt > latest.updatedAt ? entry : latest), null);
};

// 画面の右下に浮かべるパネル。「直近の実行結果」と「送信完了の自動検知」の最新を表示し、閉じても下のボタンから開き直せる
export default function ResultDock({ job, watchEntries, watchLoaded, onOpenLog }: ResultDockProps) {
  const [jobOpen, setJobOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const lastJobKey = useRef("");
  const lastWatchKey = useRef<string | null>(null);

  // 処理が終わる（または状態が変わる）たびに、実行結果を自動で開く
  useEffect(() => {
    if (!job) return;
    const key = `${job.id}:${job.status}`;
    if (key !== lastJobKey.current) {
      lastJobKey.current = key;
      setJobOpen(true);
    }
  }, [job]);

  // 見張りの状態が変わったら、自動検知を自動で開く（ページを開いた直後は開かない）
  useEffect(() => {
    if (!watchLoaded) return;

    const latest = latestEntry(watchEntries);
    const key = latest ? `${latest.leadId}:${latest.state}:${latest.updatedAt}` : "";

    if (lastWatchKey.current === null) {
      lastWatchKey.current = key;
      return;
    }

    if (key !== lastWatchKey.current) {
      lastWatchKey.current = key;
      if (latest) setWatchOpen(true);
    }
  }, [watchEntries, watchLoaded]);

  const latest = latestEntry(watchEntries);
  const watchingCount = watchEntries.filter((entry) => entry.state === "watching").length;

  if (!job && !latest) {
    return null;
  }

  return (
    <div className="result-dock" aria-live="polite">
      <div className="dock-popups">
      {jobOpen && job && (
        <section className="dock-popup" role="dialog" aria-label="直近の実行結果">
          <div className="dock-popup-head">
            <div>
              <strong>直近の実行結果</strong>
              <span className="dock-popup-sub">
                {job.label} / {formatDateTime(job.startedAt)}
              </span>
            </div>
            <span className={jobStatusClass(job.status)}>{statusLabel(job.status)}</span>
            <button className="btn secondary icon-only" type="button" onClick={() => setJobOpen(false)} title="閉じる">
              <X size={14} />
            </button>
          </div>
          {job.status === "success" && <p className="dock-popup-text">{buildResultMessage(job)}</p>}
          <pre className="log-output dock-log">{outputText(job) || "出力はありません。"}</pre>
        </section>
      )}

      {watchOpen && latest && (
        <section className="dock-popup" role="dialog" aria-label="送信完了の自動検知">
          <div className="dock-popup-head">
            <div>
              <strong>送信完了の自動検知</strong>
              <span className="dock-popup-sub">
                見張り中 {watchingCount}件 / 更新 {formatDateTime(latest.updatedAt)}
              </span>
            </div>
            <span className={watchStateLabel(latest.state).className}>{watchStateLabel(latest.state).text}</span>
            <button className="btn secondary icon-only" type="button" onClick={() => setWatchOpen(false)} title="閉じる">
              <X size={14} />
            </button>
          </div>
          <p className="dock-popup-text">
            <LeadLink leadId={latest.leadId} label={`${latest.leadId} ${latest.companyName}`} />
            {latest.message ? `：${latest.message}` : latest.state === "watching" ? "：送信完了画面を待っています" : ""}
          </p>
          <p className="dock-popup-hint">
            一覧は、
            <button type="button" className="link-button" onClick={onOpenLog}>
              ログ
            </button>
            で確認できます。
          </p>
        </section>
      )}

      </div>

      <div className="dock-pills">
        {job && !jobOpen && (
          <button className="dock-pill" type="button" onClick={() => setJobOpen(true)}>
            直近の実行結果
            <span className={jobStatusClass(job.status)}>{statusLabel(job.status)}</span>
          </button>
        )}
        {latest && !watchOpen && (
          <button className="dock-pill" type="button" onClick={() => setWatchOpen(true)}>
            送信完了の自動検知
            {watchingCount > 0 && <span className="status-badge waiting">見張り中 {watchingCount}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
