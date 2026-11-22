# The studio's WhatsApp reply desk (server.js): a linked WhatsApp session (Baileys),
# Claude Code for drafts and automatic replies, the brief and the appointment book.
# The portal shows it as the WhatsApp tab (src/app/whatsapp-desk, lib/whatsapp-desk-proxy.ts).
#
# Claude Code runs on the studio's subscription, not an API key: a long-lived token from
# `claude setup-token`, pasted once into the desk (the key button, on this PC only) and kept
# in the data volume.

FROM node:22-bookworm-slim

# Claude Code, the same version the desk was built against on the studio's PC.
RUN npm install -g @anthropic-ai/claude-code@2.1.296 && claude --version

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js business.md ./
COPY public ./public

ENV NODE_ENV=production \
    PORT=3477 \
    DESK_HOST=0.0.0.0 \
    DESK_DATA=/app/data \
    CLAUDE_BIN=claude \
    TZ=Asia/Amman

# The WhatsApp session, chats, appointments, company info and the Claude token.
VOLUME /app/data
EXPOSE 3477

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3477/api/settings').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
