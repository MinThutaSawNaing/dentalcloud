# syntax=docker/dockerfile:1.7

################################################################################
# Production Docker image for DentalCloud (Vite + React static application)
#
# Build example:
#   docker build -t dentalcloud:prod .
#
# Run example:
#   docker run --rm -p 3000:3000 dentalcloud:prod
#
# Note: Vite embeds client-side environment values at build time. AI credentials
# are configured by an administrator in Settings and never belong in this image.
################################################################################

FROM node:20-alpine AS deps

WORKDIR /app

# Install dependencies in a separate layer for better build caching.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund


FROM node:20-alpine AS build

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build


FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

ENV NODE_ENV=production

# nginxinc/nginx-unprivileged listens comfortably on non-privileged ports.
ENV NGINX_PORT=3000

COPY --chown=101:101 --from=build /app/dist /usr/share/nginx/html

USER root

RUN cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
    listen 3000;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    server_tokens off;

    gzip on;
    gzip_vary on;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/json
        application/xml
        application/rss+xml
        image/svg+xml;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(self), microphone=(), geolocation=()" always;

    location = /health {
        access_log off;
        add_header Content-Type text/plain;
        return 200 "ok\n";
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;
        try_files $uri =404;
    }

    location ~* \.(?:js|css|mjs|png|jpg|jpeg|gif|ico|svg|webp|avif|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable" always;
        try_files $uri =404;
    }

    # Client-side routing fallback for the Vite single-page application.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

USER 101

CMD ["nginx", "-g", "daemon off;"]