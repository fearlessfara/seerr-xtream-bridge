FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S bridge && adduser -S bridge -G bridge \
  && mkdir -p /data && chown -R bridge:bridge /data /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER bridge
VOLUME ["/data"]
EXPOSE 5056
CMD ["node", "dist/server.js"]
