FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:22-bookworm-slim
ARG SOURCE_REVISION=local
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /srv/data && chown -R node:node /srv/data
USER node
ENV NODE_ENV=production DATA_DIR=/srv/data PORT=3000 APP_REVISION=$SOURCE_REVISION
EXPOSE 3000 3001
CMD ["node","dist/server.js"]
