FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3030 \
    HOST=0.0.0.0 \
    CHROME_PATH=/usr/bin/chromium

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    dumb-init \
    fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3030

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.mjs"]

