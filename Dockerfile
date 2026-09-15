# The studio's platform as a container, for running it on the studio's own PC.
# Render builds the same app natively; this image does the same two things on
# start that Render does — apply migrations, then serve — so the two stay alike.
FROM node:22-bookworm-slim

# Prisma's migration engine needs OpenSSL; the slim image does not ship it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code change does not reinstall them. The schema has
# to be present already: `npm ci` runs `prisma generate` as its postinstall.
# Dev dependencies stay in, as they do on Render — `prisma migrate deploy` at
# start needs the Prisma CLI.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
