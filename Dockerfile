FROM oven/bun:1-alpine
WORKDIR /app

# Install dependencies first (layer cache)
COPY shared/ ./shared/
COPY server/package.json ./server/
RUN cd server && bun install --production

# Copy source
COPY server/src/ ./server/src/

EXPOSE 3000
CMD ["bun", "server/src/index.ts"]
