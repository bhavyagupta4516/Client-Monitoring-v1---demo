FROM node:20-alpine

WORKDIR /app

# Copy and install dependencies first (Docker caches this layer)
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Run as non-root user for security
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
