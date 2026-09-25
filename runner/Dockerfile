FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:22-bookworm-slim
ARG INSTALL_CODEX_CLI=false
RUN if [ "$INSTALL_CODEX_CLI" = "true" ]; then npm install -g @openai/codex; fi
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
RUN chmod +x scripts/*.sh && mkdir -p /runner-data && chown -R node:node /runner-data
USER node
ENV NODE_ENV=production RUNNER_DATA_DIR=/runner-data
CMD ["node","dist/main.js"]
