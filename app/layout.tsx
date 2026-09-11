import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "営業ツール ダッシュボード",
  description: "Web制作営業支援ツールのダッシュボード"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
          <header className="border-b border-[var(--border)] px-4 py-3">
            <h1 className="text-lg font-semibold">営業ツール ダッシュボード</h1>
            <nav className="mt-2 flex gap-4 text-sm">
              <Link className="hover:underline" href="/leads">
                リード一覧
              </Link>
              <Link className="hover:underline" href="/collect">
                候補収集
              </Link>
              <Link className="hover:underline" href="/actions">
                実行操作
              </Link>
            </nav>
          </header>
          <main className="flex-1 px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
