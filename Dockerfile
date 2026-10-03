# Build and runtime use the same Node major/ABI (node:24-alpine) so
# native addons like better-sqlite3 are compiled for the image that runs them.
FROM node:24-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev \
  && npm rebuild better-sqlite3

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg package provides ffprobe for VOD candidate media probing.
RUN apk add --no-cache ffmpeg \
  && ffprobe -version

RUN addgroup -S bridge && adduser -S bridge -G bridge \
  && mkdir -p /data && chown -R bridge:bridge /data /app

COPY --from=build --chown=bridge:bridge /app/package.json ./
COPY --from=build --chown=bridge:bridge /app/package-lock.json ./
COPY --from=build --chown=bridge:bridge /app/node_modules ./node_modules
COPY --from=build --chown=bridge:bridge /app/dist ./dist

USER bridge
VOLUME ["/data"]
EXPOSE 5056
CMD ["node", "dist/server.js"]
