#!/usr/bin/env bash
# 営業ツール ダッシュボードのLaunchAgentを操作するヘルパー。
#
#   ./scripts/services.sh start     # 起動（常時起動設定のため通常は不要）
#   ./scripts/services.sh stop      # 停止
#   ./scripts/services.sh restart   # コード更新後の再起動に使用
#   ./scripts/services.sh status    # 状態表示（既定）
#
# 対象: com.websalestool.dashboard (Next.js 本番サーバー :3100)
set -uo pipefail

UID_NUM="$(id -u)"
LABEL="com.websalestool.dashboard"

dom() { echo "gui/${UID_NUM}/$1"; }

agent_start() {
  if ! launchctl print "$(dom "$LABEL")" >/dev/null 2>&1; then
    echo "  ! $LABEL が bootstrap されていません: launchctl bootstrap gui/${UID_NUM} ~/Library/LaunchAgents/${LABEL}.plist"
    return 1
  fi
  launchctl kickstart -k "$(dom "$LABEL")" && echo "  ✓ started $LABEL"
}

agent_stop() {
  launchctl kill SIGTERM "$(dom "$LABEL")" 2>/dev/null || true
  echo "  ✓ stopped $LABEL"
}

http_ok() { curl -sf -m 2 -o /dev/null "$1"; }

do_status() {
  printf "  dashboard (:3100) : %s\n" "$(http_ok http://127.0.0.1:3100/ && echo up || echo down)"
}

ACTION="${1:-status}"

case "$ACTION" in
  start)
    agent_start
    ;;
  stop)
    agent_stop
    ;;
  restart)
    agent_stop
    sleep 1
    agent_start
    ;;
  status|"")
    do_status
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
