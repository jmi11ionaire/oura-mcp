FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY build/ ./build/

# Commit the image was built from; /health reports it as version.
# Deploys pass it with --build-arg COMMIT_SHA=$(git rev-parse HEAD).
ARG COMMIT_SHA=unknown
ENV COMMIT_SHA=$COMMIT_SHA

# Run as the unprivileged user the node image provides. There is no volume, and
# /app is root-owned but world-readable, which is all the server needs.
USER node

# The server listens on PORT (Fly injects this)
ENV PORT=8080
EXPOSE 8080

CMD ["node", "build/server.js"]
