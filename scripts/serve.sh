#!/usr/bin/env zsh
# 営業ツール ダッシュボードの本番サーバを起動する。LaunchAgent (com.websalestool.dashboard) から呼ばれる想定。
set -e

APP_DIR="${WEBSALESTOOL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
NODE="${WEBSALESTOOL_NODE:-$HOME/.nvm/versions/node/v20.20.2/bin/node}"
BIND="${WEBSALESTOOL_BIND:-127.0.0.1}"   # 127.0.0.1 = tailscale serve 経由以外からの直接アクセスを遮断
APP_PORT="${WEBSALESTOOL_PORT:-3100}"
SERVE_PORT="${WEBSALESTOOL_SERVE_PORT:-8443}"   # 443はローカルnginxと衝突するため使わない
TAILSCALE_LOG="$HOME/Library/Logs/websalestool-tailscale.log"

cd "$APP_DIR"

# ビルドが無ければ作る（コード更新後は手動で `npm run dashboard:build` → `launchctl kickstart -k gui/$(id -u)/com.websalestool.dashboard`）
if [ ! -f .next/BUILD_ID ]; then
  "$NODE" node_modules/next/dist/bin/next build
fi

# Mac起動直後はTailscaleが切断・Serve未設定になっていることがあるため、
# バックグラウンドで復旧を試みる（失敗してもダッシュボード起動はブロックしない）
# tailscale serve は funnel と異なりtailnet内限定公開（インターネットには公開しない）。
# アプリ自体は127.0.0.1のみにバインドしているため、serve経由以外の直接アクセスはできない。
(
  if command -v tailscale >/dev/null 2>&1; then
    {
      echo "--- $(date) ---"
      if tailscale status 2>&1 | head -1 | grep -qi "stopped"; then
        echo "Tailscale is stopped. Running tailscale up..."
        tailscale up
      fi
      if ! tailscale serve status 2>&1 | grep -q "https://.*:$SERVE_PORT"; then
        echo "Serve is not active. Configuring serve on :$SERVE_PORT -> :$APP_PORT..."
        tailscale serve --bg --https="$SERVE_PORT" "$APP_PORT"
      fi
    } >> "$TAILSCALE_LOG" 2>&1
  fi
) &

exec "$NODE" node_modules/next/dist/bin/next start -H "$BIND" -p "$APP_PORT"
