# 営業ツール ダッシュボードをサーバーで動かすためのイメージ。
# Mac専用のフォーム自動入力（Chrome遠隔操作）は使わない前提（ブックマークレット方式）。
FROM node:20-bookworm-slim

WORKDIR /app

# ジョブ（npm run ...）が ts-node を使うため、devDependencies も含めて入れる
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
# サーバーにはChromeがないため、フォーム自動入力（ブラウザの遠隔操作）は無効にする
ENV WEBSALESTOOL_BROWSER_AUTOFILL=0
RUN npm run dashboard:build

# データ（実行履歴など）はボリュームに置く
VOLUME ["/app/data", "/app/.tmp"]

EXPOSE 3100
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3100"]
