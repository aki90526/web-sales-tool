"use client";

import { useState } from "react";

// 見送りの再確認までの期間。空欄は、設定画面（設定シート）の既定の日数
export const SKIP_PERIOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "既定（設定画面の日数）" },
  { value: "7", label: "1週間後" },
  { value: "14", label: "2週間後" },
  { value: "30", label: "1か月後" },
  { value: "90", label: "3か月後" },
  { value: "180", label: "半年後" },
  { value: "365", label: "1年後" },
  { value: "なし", label: "再確認しない" }
];

export const skipPeriodLabel = (value: string): string => {
  if (!value) return "既定の期間";
  if (value === "なし") return "再確認しない";
  const option = SKIP_PERIOD_OPTIONS.find((entry) => entry.value === value);
  return option ? option.label : `${value}日後`;
};

type SkipPeriodDialogProps = {
  title: string;
  companyName: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

// 見送りにするとき（または見送りのリードの再確認の期間を変えるとき）に、送信待ちへ戻すかを再確認するまでの期間を選ぶ
export default function SkipPeriodDialog({ title, companyName, initialValue = "", confirmLabel = "決定", onConfirm, onCancel }: SkipPeriodDialogProps) {
  const [value, setValue] = useState(initialValue);
  // 一覧にない日数（設定画面やシートで直接入れた値）も、選択肢に出す
  const options = SKIP_PERIOD_OPTIONS.some((option) => option.value === initialValue)
    ? SKIP_PERIOD_OPTIONS
    : [...SKIP_PERIOD_OPTIONS, { value: initialValue, label: `${initialValue}日後` }];

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel skip-dialog" onClick={(event) => event.stopPropagation()}>
        <h3 className="panel-title">{title}</h3>
        <p className="panel-caption">{companyName}</p>

        <label className="field skip-dialog-field">
          再確認までの期間
          <select value={value} onChange={(event) => setValue(event.target.value)}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small className="panel-caption">
            この期間がたつと、公式サイトと連絡先を確認し直し、送信できそうなら「送信待ち」に戻します（毎朝の自動処理）。
          </small>
        </label>

        <div className="btn-row skip-dialog-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="btn primary" onClick={() => onConfirm(value)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
