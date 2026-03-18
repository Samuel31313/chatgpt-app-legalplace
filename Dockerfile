FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN npx tsc
RUN npm prune --omit=dev

EXPOSE 8787

CMD ["node", "dist/server.js"]
