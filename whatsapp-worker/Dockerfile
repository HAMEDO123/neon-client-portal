# The worker runs a real Chromium, so it ships as a container rather than on a
# plain Node runtime. Debian's chromium is used instead of the one puppeteer
# downloads: it is the build that actually works on this base image.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package.json ./
COPY vendor ./vendor
RUN npm install --omit=dev

COPY server.mjs ./

# The login and the send journal live here. Mount a disk on it, or a restart
# means scanning the QR again.
VOLUME ["/app/data"]

EXPOSE 4100
CMD ["node", "server.mjs"]
