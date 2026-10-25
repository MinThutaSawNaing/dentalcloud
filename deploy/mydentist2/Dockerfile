FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

USER root
COPY --chmod=644 nginx.conf /etc/nginx/nginx.conf
COPY --chown=101:101 dist/ /usr/share/nginx/html/
USER 101:101

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]