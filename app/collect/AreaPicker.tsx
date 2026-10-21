"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MUNICIPALITIES, PREFECTURES } from "../../src/data/municipalities";

type AreaPickerProps = {
  onChange: (area: string) => void;
};

// 都道府県を選ぶと市区町村が出て、複数選択できる。選んだ内容は「東京都渋谷区 新宿区」の形でエリア欄に反映する
export default function AreaPicker({ onChange }: AreaPickerProps) {
  const [prefecture, setPrefecture] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  const municipalities = useMemo(() => {
    const all = prefecture ? MUNICIPALITIES[prefecture] ?? [] : [];
    const keyword = filter.trim();
    return keyword ? all.filter((name) => name.includes(keyword)) : all;
  }, [prefecture, filter]);

  // 選択が変わるたびにエリア欄へ反映する（連続クリックでも取りこぼさないよう、state の変化を契機にする）
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!prefecture) {
      return;
    }
    onChangeRef.current(selected.length > 0 ? `${prefecture}${selected.join(" ")}` : prefecture);
  }, [prefecture, selected]);

  const changePrefecture = (value: string) => {
    setPrefecture(value);
    setSelected([]);
    setFilter("");
  };

  const toggle = (name: string) => {
    setSelected((current) => (current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]));
  };

  const clear = () => setSelected([]);

  return (
    <div className="area-picker">
      <div className="area-picker-head">
        <span className="area-suggestion-label">県・市区町村</span>
        <select value={prefecture} onChange={(event) => changePrefecture(event.target.value)} aria-label="都道府県">
          <option value="">都道府県を選択</option>
          {PREFECTURES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {prefecture && (
          <>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="市区町村を絞り込み"
              aria-label="市区町村を絞り込み"
            />
            <button className="area-chip" type="button" onClick={clear} disabled={selected.length === 0}>
              選択を解除（{selected.length}）
            </button>
          </>
        )}
      </div>

      {prefecture && (
        <div className="area-chip-row area-picker-list">
          {municipalities.length === 0 ? (
            <span className="area-empty">該当する市区町村がありません</span>
          ) : (
            municipalities.map((name) => (
              <button
                key={name}
                className={`area-chip${selected.includes(name) ? " active" : ""}`}
                type="button"
                aria-pressed={selected.includes(name)}
                onClick={() => toggle(name)}
              >
                {name}
              </button>
            ))
          )}
        </div>
      )}
      {prefecture && <p className="area-picker-note">未選択なら「{prefecture}」全体で検索します。出典: Geolonia 住所データ（CC BY 4.0）</p>}
    </div>
  );
}
