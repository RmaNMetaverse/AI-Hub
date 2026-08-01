FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run css:build

ENV NODE_ENV=production
ENV PORT=4310
EXPOSE 4310

CMD ["node", "server.js"]
