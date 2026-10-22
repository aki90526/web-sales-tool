"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { formatDateTime, LeadLink, watchStateLabel, type FormWatchEntry } from "./shared";

type ResultDockProps = {
  watchEntries: FormWatchEntry[];
  // 見張りの一覧を最初に読み込み終えたか（読み込み直後は、自動で開かない）
  watchLoaded: boolean;
  // 「ログ」（一覧）を開く
  onOpenLog?: () => void;
};

const latestEntry = (entries: FormWatchEntry[]): FormWatchEntry | null => {
  return entries.reduce<FormWatchEntry | null>((latest, entry) => (!latest || entry.updatedAt > latest.updatedAt ? entry : latest), null);
};

// 画面の左下に浮かべるパネル。「送信完了の自動検知」の最新を表示し、閉じても下のボタンから開き直せる（直近の実行結果は、下の帯に表示する）
export default function ResultDock({ watchEntries, watchLoaded, onOpenLog }: ResultDockProps) {
  const [watchOpen, setWatchOpen] = useState(false);
  const lastWatchKey = useRef<string | null>(null);

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

  if (!latest) {
    return null;
  }

  return (
    <div className="result-dock" aria-live="polite">
      <div className="dock-popups">
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
