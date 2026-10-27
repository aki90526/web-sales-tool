#!/usr/bin/env zsh
# Gmail返信同期（返信と面談予約の反映）を実行し、結果をログとmacOS通知で知らせる。
# LaunchAgent (com.websalestool.gmailsync) から、決まった時刻に呼ばれる想定。
set -u

APP_DIR="${WEBSALESTOOL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="$HOME/Library/Logs/websalestool-gmailsync.log"

notify() {
  /usr/bin/osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true
}

cd "$APP_DIR" || exit 1

echo "--- $(date) ---" >> "$LOG"

if OUT="$(npm run gmail:sync-replies 2>&1)"; then
  echo "$OUT" >> "$LOG"
  COUNT="$(echo "$OUT" | grep -o 'DASHBOARD_SUMMARY\] count=[0-9]*' | tail -1 | grep -o '[0-9]*$')"
  if [ -n "${COUNT:-}" ] && [ "$COUNT" -gt 0 ]; then
    notify "営業ツール" "返信・面談予約を${COUNT}件、シートに反映しました"
  fi
  # 迷惑メールのフォルダに入っていた返信は、見落としやすいので、別に知らせる
  SPAM="$(echo "$OUT" | grep -o 'DASHBOARD_SPAM\] count=[0-9]*' | tail -1 | grep -o '[0-9]*$')"
  if [ -n "${SPAM:-}" ] && [ "$SPAM" -gt 0 ]; then
    notify "営業ツール：迷惑メールに返信がありました" "迷惑メールのフォルダに入っていた返信を${SPAM}件、見つけました。Gmailで確認し、「迷惑メールではない」にしてください"
  fi
else
  echo "$OUT" >> "$LOG"
  # 認証切れ（invalid_grant）などの失敗は、気付けるように通知する
  notify "営業ツール：返信同期に失敗しました" "$(echo "$OUT" | grep -v '^>' | grep -v '^$' | tail -1 | cut -c1-100)"
  exit 1
fi
