# Max voice assistant. Audio goes through PulseAudio, so the container can use the
# microphone/speaker of whatever machine runs it (Linux, Mac or Windows) - see docs/DOCKER.md.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends alsa-utils libasound2-plugins pulseaudio-utils \
 && rm -rf /var/lib/apt/lists/*
# Route ALSA's "default" device (used by arecord/aplay) to the PulseAudio server in $PULSE_SERVER.
RUN printf 'pcm.!default { type pulse }\nctl.!default { type pulse }\n' > /etc/asound.conf
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Max's memory lives here (a Docker volume, so it survives restarts and rebuilds).
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "dist/main.js"]
