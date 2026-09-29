# PlaywrightがChromiumを動かすのに必要なシステムライブラリを含む公式イメージを使う。
# Renderの通常のNode実行環境（apt権限なし）ではPlaywrightのブラウザ依存関係を揃えられないため、
# このサービスだけDockerビルドにしている（render.yaml参照）。
# バージョンはbackend/package.jsonのplaywrightのバージョンと必ず合わせること（ブラウザ本体とライブラリのズレを防ぐため）
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# マイグレーション適用はここ（ビルド時）ではなく起動時に行う。
# ビルド時点ではRenderの本番データベースへネットワーク到達できるとは限らないため
CMD ["npm", "start"]
