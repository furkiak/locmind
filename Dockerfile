# syntax=docker/dockerfile:1
# Locmind has no runtime dependencies: the image is Node.js plus the source, nothing is installed.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    MEDIA_DIR=/media \
    LOG_FORMAT=json

COPY package.json server.js ./
COPY src ./src
COPY shared ./shared
COPY public ./public

RUN mkdir -p /data /media/music /media/uploads && chown -R node:node /data /media
USER node
VOLUME ["/data", "/media"]

# web, STUN/TURN (udp + tcp), TURN over TLS, relay ports
EXPOSE 3000/tcp 3478/udp 3478/tcp 5349/tcp 49160-49359/udp

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server.js"]
