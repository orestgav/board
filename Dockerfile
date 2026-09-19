FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git git-lfs \
  && rm -rf /var/lib/apt/lists/* \
  && git lfs install --system

WORKDIR /app
COPY . .

ENV HOST=0.0.0.0
ENV PORT=4173
ENV BOARD_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 4173

CMD ["node", "deploy/start.mjs"]
