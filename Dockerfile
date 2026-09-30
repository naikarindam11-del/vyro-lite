FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV VYRO_HOST=0.0.0.0
ENV VYRO_DATA_DIR=/data
ENV VYRO_VAULT_DIR=/data/vault
COPY package.json ./
COPY tsconfig.json ./
COPY config ./config
COPY public ./public
COPY src ./src
RUN mkdir -p /data/vault && chown -R node:node /app /data
USER node
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/index.ts"]
