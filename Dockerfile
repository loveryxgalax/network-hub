# Network Hub dashboard. Data (SQLite + master.key) lives in the /data volume, never in the image.
FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 NETWORK_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.cjs ./
COPY lib ./lib
COPY dist ./dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4317/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.cjs"]
