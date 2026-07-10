FROM node:22-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS deps
WORKDIR /workspace/apps/docs
COPY apps/docs/package*.json ./
RUN npm ci

FROM deps AS build
COPY apps/docs/web ./web
COPY packages /workspace/packages
RUN npm run build

FROM node:22-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS runtime
ENV NODE_ENV=production \
    PORT=3003 \
    DATA_DIR=/app/data \
    DOCS_DIR=/app/docs \
    DOCS_DEFAULT_DIR=/app/docs-default \
    TZ=Asia/Bangkok
WORKDIR /workspace/apps/docs
COPY apps/docs/package*.json ./
RUN apk add --no-cache tzdata \
    && npm ci --omit=dev \
    && npm cache clean --force
COPY apps/docs/server ./server
COPY packages /workspace/packages
COPY --from=build /workspace/apps/docs/dist ./dist
COPY --chown=node:node apps/docs/content /app/docs-default
RUN mkdir -p /app/data /app/docs \
    && chown node:node /app/data /app/docs
USER node
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3003/api/health || exit 1
CMD ["node", "server/server.cjs"]
