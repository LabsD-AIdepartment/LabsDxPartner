FROM node:24.18.0-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-fund
COPY . .
RUN node scripts/build-hosted-demo.mjs
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "scripts/start-hosted-demo.mjs"]
