FROM node:20-slim

WORKDIR /app

# Copy package files and install deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy built JS
COPY build/ ./build/

# The server listens on PORT (Fly injects this)
ENV PORT=8080
EXPOSE 8080

CMD ["node", "build/server.js"]
