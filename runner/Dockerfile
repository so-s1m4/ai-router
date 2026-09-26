FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:22-bookworm-slim
ARG INSTALL_CODEX_CLI=false
ARG INSTALL_AGY_CLI=false
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl bash \
  && rm -rf /var/lib/apt/lists/* \
  && if [ "$INSTALL_CODEX_CLI" = "true" ]; then npm install -g @openai/codex; fi \
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
RUN chmod +x scripts/*.sh && mkdir -p /runner-data && chown -R node:node /runner-data
USER node
ENV NODE_ENV=production RUNNER_DATA_DIR=/runner-data SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt AGY_CLI_DISABLE_AUTO_UPDATE=true
CMD ["node","dist/main.js"]
