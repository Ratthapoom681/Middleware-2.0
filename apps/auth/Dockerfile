FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS deps
WORKDIR /workspace/apps/auth
COPY apps/auth/package*.json ./
RUN npm ci

FROM deps AS build
COPY apps/auth/web ./web
COPY packages /workspace/packages
RUN npm run build

FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS runtime
ENV NODE_ENV=production PORT=3004 DATA_DIR=/app/data TZ=Asia/Bangkok
WORKDIR /workspace/apps/auth
COPY apps/auth/package*.json ./
RUN apk add --no-cache tzdata \
    && npm ci --omit=dev \
    && npm cache clean --force
COPY apps/auth/server ./server
COPY packages /workspace/packages
COPY --from=build /workspace/apps/auth/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3004/api/auth/health/ready || exit 1
CMD ["node", "server/server.cjs"]
