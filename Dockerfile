# The studio's platform as a container, for running it on the studio's own PC.
# Render builds the same app natively; this image does the same two things on
# start that Render does — apply migrations, then serve — so the two stay alike.
FROM node:22-bookworm-slim

# Prisma's migration engine needs OpenSSL; the slim image does not ship it.
#
# The fonts are for the gallery PDF. The slim image ships **no fonts at all**,
# so libvips drew an empty box per character — for Latin as much as Arabic —
# while reporting success, which is the worst way for it to fail. Noto Naskh
# Arabic arrives with fonts-noto-core, and pango/harfbuzz then does real Arabic
# shaping and right-to-left ordering, which is why the PDF rasterises the text
# it cannot encode rather than embedding a font through fontkit: fontkit draws
# the glyphs but joins nothing and reverses nothing, producing a file that
# builds and is still wrong to anybody who reads Arabic.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl \
      ca-certificates \
      fontconfig \
      fonts-noto-core \
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
