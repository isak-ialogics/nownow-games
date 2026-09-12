FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine

LABEL org.opencontainers.image.source="https://github.com/isak-ialogics/nownow-games"

WORKDIR /app
ENV HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=80

COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 80

# node:alpine includes BusyBox wget. The deployment automation requires this
# container-level health state before it declares the update successful.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["node", "server/app.mjs"]
