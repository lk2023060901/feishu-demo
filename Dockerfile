FROM node:22-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV HOST=0.0.0.0 \
    PORT=3030 \
    SHOW_BROWSER=0 \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_NO_SANDBOX=1

EXPOSE 3030

CMD ["npm", "start"]
