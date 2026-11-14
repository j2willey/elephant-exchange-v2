# Elephant Exchange: one image with the server and the built web app.
# Build: docker build -t elephant-exchange .     Run: see compose.yaml.

FROM node:26.8.2-trixie-slim AS build
# better-sqlite3 is compiled code: these build it if no ready-made binary fits this Node.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Dependencies first, so they're rebuilt only when a package.json or the lockfile changes.
COPY package.json package-lock.json ./
COPY packages/rules/package.json packages/rules/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY packages packages
RUN npm run build --workspace @elephant/web \
 && npm prune --omit=dev

FROM node:26.8.2-trixie-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/elephant.db \
    WEB_ROOT=/app/packages/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/rules/package.json packages/rules/
COPY --from=build /app/packages/rules/src packages/rules/src
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/server/src packages/server/src
# The migrations: the server brings the database up to date with them as it starts.
COPY --from=build /app/packages/server/drizzle packages/server/drizzle
COPY --from=build /app/packages/web/dist packages/web/dist
# The database lives on a volume, so it outlives the container. Run as the unprivileged node user.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
# Docker marks the container unhealthy if the app or its database stops answering. (No curl in the slim image.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# One process (no npm or tsx wrapper in between), so `docker stop`'s SIGTERM reaches the server and it shuts down cleanly.
CMD ["node", "--import", "tsx", "packages/server/src/main.ts"]
