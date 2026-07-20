# ── Stage 1: build ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy production deps
COPY package.json ./
RUN npm install --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Copy migrations (run at startup via scripts/start.js)
COPY migrations ./migrations
COPY scripts ./scripts

EXPOSE 3000

# Auto-migrate then start the server
CMD ["node", "scripts/start.js"]
