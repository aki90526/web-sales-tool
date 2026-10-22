"use client";

import { useEffect } from "react";
import { Undo2, X } from "lucide-react";

export type UndoToastData = {
  // 同じ内容でも別の通知として扱うための値
  key: number;
  message: string;
};

type UndoToastProps = {
  toast: UndoToastData | null;
  onUndo: () => void;
  onClose: () => void;
  // 自動で消えるまでの時間（ミリ秒）
  duration?: number;
};

// ステータスを変更した直後に、画面の下に数秒だけ出して、「元に戻す」を押せるようにする通知
export default function UndoToast({ toast, onUndo, onClose, duration = 10000 }: UndoToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.key, duration]);

  if (!toast) {
    return null;
  }

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span>{toast.message}</span>
      <button type="button" className="btn secondary" onClick={onUndo}>
        <Undo2 size={15} />
        元に戻す
      </button>
      <button type="button" className="btn secondary icon-only" onClick={onClose} title="閉じる">
        <X size={14} />
      </button>
    </div>
  );
}
