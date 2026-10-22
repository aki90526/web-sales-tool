"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { buildResultMessage, formatDateTime, jobStatusClass, outputText, statusLabel, type DashboardJob } from "./shared";

type ResultBarProps = {
  // 直近に実行した処理（このページで実行したもの）
  job: DashboardJob | null;
};

// 画面の下の帯に、直近の実行結果を1行で表示する。押すと上へ開いて、ログの全文が見える（自動では開かない）
export default function ResultBar({ job }: ResultBarProps) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const lastKey = useRef("");

  // 新しい結果が出たら「新着」の印を付ける（開いたときに消える）
  useEffect(() => {
    if (!job) return;
    const key = `${job.id}:${job.status}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      if (job.status !== "running") setUnread(true);
    }
  }, [job]);

  if (!job) {
    return null;
  }

  const summary = job.status === "success" ? buildResultMessage(job) : job.status === "failed" ? "失敗しました。ログを開いて確認してください。" : "実行中です...";

  const toggle = () => {
    setOpen((current) => !current);
    setUnread(false);
  };

  return (
    <div className="result-bar">
      {open && (
        <section className="result-bar-panel" role="region" aria-label="直近の実行結果">
          <div className="result-bar-panel-head">
            <div>
              <strong>直近の実行結果</strong>
              <span className="dock-popup-sub">
                {job.label} / {formatDateTime(job.startedAt)}
              </span>
            </div>
            <span className={jobStatusClass(job.status)}>{statusLabel(job.status)}</span>
          </div>
          {job.status === "success" && <p className="dock-popup-text">{summary}</p>}
          <pre className="log-output result-bar-log">{outputText(job) || "出力はありません。"}</pre>
        </section>
      )}

      <button type="button" className={`result-bar-button${job.status === "failed" ? " failed" : ""}`} aria-expanded={open} onClick={toggle}>
        <strong>直近の実行結果</strong>
        <span className={jobStatusClass(job.status)}>{statusLabel(job.status)}</span>
        {unread && <span className="result-bar-new">新着</span>}
        <span className="result-bar-summary">
          {job.label}：{summary}
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
    </div>
  );
}
