FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:22-bookworm-slim
ARG INSTALL_CODEX_CLI=false
ARG CODEX_CLI_VERSION=latest
ARG INSTALL_AGY_CLI=false
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       bash \
       git \
       openssh-client \
       ripgrep \
       poppler-utils \
       python3 \
       chromium \
       fonts-liberation \
       libasound2 \
       libnss3 \
       libxss1 \
  && chromium --version \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @playwright/mcp@0.0.82 \
  && if [ "$INSTALL_CODEX_CLI" = "true" ]; then npm install -g "@openai/codex@$CODEX_CLI_VERSION" && codex --version; fi \
  && if [ "$INSTALL_AGY_CLI" = "true" ]; then \
       curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh \
       && bash /tmp/agy-install.sh --dir /usr/local/bin \
       && rm /tmp/agy-install.sh \
       && agy --version; \
     fi
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
RUN chmod +x scripts/*.sh scripts/deploy-preview && ln -s /app/scripts/deploy-preview /usr/local/bin/deploy-preview && mkdir -p /runner-data && chown -R node:node /runner-data
USER node
ENV PATH="/runner-data/cli/current/codex:/runner-data/cli/current/antigravity:${PATH}" \
    CLI_AUTO_UPDATE=true \
    CLI_UPDATE_INTERVAL_SECONDS=21600 \
    NODE_ENV=production \
    RUNNER_DATA_DIR=/runner-data \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    AGY_CLI_DISABLE_AUTO_UPDATE=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
CMD ["node","dist/main.js"]
