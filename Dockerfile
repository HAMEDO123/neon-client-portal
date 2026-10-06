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
# ffmpeg turns voice notes an iPhone cannot play (a WhatsApp .opus, a Chrome
# webm) into AAC — lib/voice-transcode.ts. Without it they are kept as they came.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl \
      ca-certificates \
      fontconfig \
      fonts-noto-core \
      ffmpeg \
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
# A deploy id for this build, so a page left open across an update reloads
# itself instead of failing its server actions (see next.config.ts). Taken from
# the clock at build time rather than passed in: a build argument is a habit,
# and a forgotten habit leaves this silently switched off. The layer is cached
# with the sources, so an unchanged build keeps its id — which is correct.
#
# And the key Next encrypts a server function's closure variables with. Every
# upload form on the project tabs is `action.bind(null, project.id)`, and that
# bound id is encrypted and sent to the browser. **Next makes a new key on
# every build unless it is given one**, so a page rendered before a deploy can
# never have its bound argument decrypted afterwards — "Failed to find Server
# Action", answered 404, which the browser reports as "An unexpected response
# was received from the server" with nothing in the log. Next's self-hosting
# guide prescribes exactly this variable.
#
# It is a build argument because the key is embedded in the build output; it
# comes from .env.docker through docker-compose.yml. Empty is the old
# behaviour — a fresh key each build — rather than a failure.
ARG NEON_ACTIONS_KEY=""
# The deploy id is **written to .deploy-id as well as handed to the build**.
# `next start` reads next.config.ts again, in a container where the variable
# no longer exists; without the file the running server has no deploy id while
# every page's JavaScript has one, and Next reloads the whole document on every
# navigation to settle the disagreement. That is what it did for three days.
RUN date -u +%Y%m%d%H%M%S > .deploy-id \
    && NEON_DEPLOY_ID="$(cat .deploy-id)" \
       NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$NEON_ACTIONS_KEY" \
       npm run build

ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
