FROM nginx:alpine
ENV TZ=Asia/Bangkok
RUN apk add --no-cache tzdata
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY hub-unavailable.html /usr/share/nginx/html/hub-unavailable.html
EXPOSE 80
