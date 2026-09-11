"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  CheckSquare,
  ListChecks,
  MailCheck,
  Plus,
  Search,
  Send,
  Sparkles
} from "lucide-react";

const navItems = [
  { href: "/", label: "ダッシュボード", icon: BarChart3 },
  { href: "/leads", label: "リード一覧", icon: ListChecks },
  { href: "/collect", label: "候補収集", icon: Search },
  { href: "/actions", label: "実行操作", icon: Send }
];

const isActivePath = (pathname: string, href: string): boolean => {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname.startsWith(href);
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <CheckSquare size={22} strokeWidth={2.4} />
          </span>
          <span>aaSales</span>
        </Link>

        <nav className="sidebar-nav" aria-label="メインメニュー">
          <p className="nav-caption">メニュー</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);

            return (
              <Link key={item.href} href={item.href} className={active ? "nav-link active" : "nav-link"}>
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-icon">
            <Bot size={18} />
          </div>
          <p className="sidebar-card-title">実行環境</p>
          <p className="sidebar-card-text">Mac上のNodeサーバーからスプレッドシートとChromeを操作します。</p>
        </div>
      </aside>

      <div className="main-frame">
        <header className="topbar">
          <div>
            <p className="eyebrow">Web sales operations</p>
            <h1>営業ツール ダッシュボード</h1>
          </div>
          <div className="topbar-actions">
            <Link className="icon-button" href="/collect" aria-label="候補収集">
              <Plus size={18} />
            </Link>
            <Link className="icon-button primary" href="/actions" aria-label="実行操作">
              <Sparkles size={18} />
            </Link>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="モバイルメニュー">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);

          return (
            <Link key={item.href} href={item.href} className={active ? "mobile-nav-link active" : "mobile-nav-link"}>
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <Link className="floating-action" href="/actions" aria-label="実行操作">
        <MailCheck size={22} />
      </Link>
    </div>
  );
}
