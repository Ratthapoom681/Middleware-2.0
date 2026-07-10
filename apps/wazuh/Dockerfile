FROM node:22-alpine@sha256:ab07539e0988b63558ff621f5fbe1077054c39d9809112974fb79993949d41cd AS build
WORKDIR /workspace/apps/wazuh
COPY apps/wazuh/package*.json ./
RUN npm ci
COPY apps/wazuh/index.html apps/wazuh/vite.config.js ./
COPY apps/wazuh/src ./src
COPY packages /workspace/packages
RUN npm run build

FROM nginx:alpine@sha256:8b1e78743a03dbb2c95171cc58639fef29abc8816598e27fb910ed2e621e589a AS runtime
ENV TZ=Asia/Bangkok
RUN apk add --no-cache tzdata
COPY --from=build /workspace/apps/wazuh/dist /usr/share/nginx/html
COPY apps/wazuh/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/ || exit 1
