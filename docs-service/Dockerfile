FROM node:22-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build

WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS runtime

ENV NODE_ENV=production \
    PORT=3003 \
    DATA_DIR=/app/data \
    TZ=Asia/Bangkok

WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache tzdata \
    && npm ci --omit=dev \
    && npm cache clean --force

COPY --from=build /app/backend ./backend
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3003/api/health || exit 1

CMD ["node", "backend/server.cjs"]
