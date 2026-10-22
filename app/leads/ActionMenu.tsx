"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type ActionMenuItem = {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  // 押せないときの理由（メニュー項目の下に小さく表示する）
  hint?: string;
  primary?: boolean;
};

type ActionMenuProps = {
  items: ActionMenuItem[];
  disabled?: boolean;
  label?: string;
};

const MENU_WIDTH = 230;

// 「操作」ボタンを押すと、その場にメニューが浮かんで、実行したい操作を選べる
export default function ActionMenu({ items, disabled = false, label = "操作" }: ActionMenuProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = () => setPosition(null);

  const toggle = () => {
    if (position) {
      close();
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    // 画面の右端・下端からはみ出さないように、位置を調整する
    const estimatedHeight = items.length * 52 + 16;
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    const top = rect.bottom + estimatedHeight > window.innerHeight ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4;
    setPosition({ top, left });
  };

  useEffect(() => {
    if (!position) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // 位置がずれないよう、スクロール・サイズ変更で閉じる
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  return (
    <>
      <button
        ref={buttonRef}
        className="btn secondary action-menu-button"
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        onClick={toggle}
      >
        {label}
        <ChevronDown size={14} />
      </button>

      {position && (
        <div ref={menuRef} className="action-menu" role="menu" style={{ top: position.top, left: position.left, width: MENU_WIDTH }}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`action-menu-item${item.primary ? " primary" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onClick();
              }}
            >
              <span className="action-menu-icon">{item.icon}</span>
              <span>
                {item.label}
                {item.disabled && item.hint && <small>{item.hint}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
