FROM nginx:alpine@sha256:8b1e78743a03dbb2c95171cc58639fef29abc8816598e27fb910ed2e621e589a
ENV TZ=Asia/Bangkok
RUN apk add --no-cache tzdata
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY hub-unavailable.html /usr/share/nginx/html/hub-unavailable.html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/gateway-health || exit 1
