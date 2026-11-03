# Build context is the REPO ROOT (the pages import types from packages/shared):
#   docker build --platform linux/arm64 -f apps/web/Dockerfile -t mechanicpulse-web .
FROM node:22-alpine AS build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN cd apps/web && npm ci
COPY apps/web apps/web
COPY packages packages
# "" = same origin as the page (the API is served under /api on one address),
# so this image has nothing environment-specific baked in.
ENV NEXT_PUBLIC_API_URL="" \
    DOCKER_BUILD=1 \
    NEXT_TELEMETRY_DISABLED=1
# public/ is empty and untracked, so a clean checkout has no such folder.
RUN mkdir -p apps/web/public && cd apps/web && npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./.next/static
COPY --from=build /app/apps/web/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
