#!/usr/bin/env bash
# Gmail返信同期の定期実行（毎日 9:00 と 17:00）を、LaunchAgentとして登録する。
#   ./scripts/install-gmail-sync.sh install     # 登録（既定）
#   ./scripts/install-gmail-sync.sh uninstall   # 解除
#   ./scripts/install-gmail-sync.sh run         # いますぐ1回実行
# 時刻を変えたいときは scripts/launchd/com.websalestool.gmailsync.plist の Hour/Minute を直して、再度 install する。
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.websalestool.gmailsync"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="${WEBSALESTOOL_NODE_BIN:-$(dirname "$(command -v node)")}"
UID_NUM="$(id -u)"

case "${1:-install}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE_BIN__|$NODE_BIN|g" -e "s|__HOME__|$HOME|g" \
      "$APP_DIR/scripts/launchd/$LABEL.plist" > "$TARGET"
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID_NUM" "$TARGET"
    echo "登録しました: $TARGET（毎日 9:00 / 17:00）"
    ;;
  uninstall)
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    rm -f "$TARGET"
    echo "解除しました"
    ;;
  run)
    launchctl kickstart "gui/$UID_NUM/$LABEL"
    echo "実行しました。ログ: $HOME/Library/Logs/websalestool-gmailsync.log"
    ;;
  *)
    echo "usage: $0 [install|uninstall|run]" >&2
    exit 1
    ;;
esac
