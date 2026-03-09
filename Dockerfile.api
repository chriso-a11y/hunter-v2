FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile
COPY packages/api ./packages/api
RUN pnpm --filter api build
CMD ["node", "packages/api/dist/index.js"]
