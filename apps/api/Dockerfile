# Build context is the REPO ROOT (the API imports packages/shared and applies
# db/migrations):
#   docker build --platform linux/arm64 -f apps/api/Dockerfile -t mechanicpulse-api .
FROM node:22-alpine AS build
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json apps/api/
RUN cd apps/api && npm ci
COPY apps/api apps/api
COPY packages packages
RUN cd apps/api && npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The build mirrors the repo layout (it pulls in packages/shared), so keep it.
COPY --from=build /app/apps/api/dist ./dist
COPY db /app/db
USER node
EXPOSE 3001
CMD ["node", "dist/apps/api/src/index.js"]
