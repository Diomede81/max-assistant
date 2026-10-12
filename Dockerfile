# Max voice assistant. Audio goes through PulseAudio, so the container can use the
# microphone/speaker of whatever machine runs it (Linux, Mac or Windows) - see docs/DOCKER.md.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
# Memory search engine: keep only this machine's runtime (the package ships every platform + GPU builds).
RUN ARCH=$(node -p process.arch) \
 && cd node_modules/onnxruntime-node/bin/napi-v6 && rm -rf darwin win32 \
 && find linux -mindepth 1 -maxdepth 1 ! -name "$ARCH" -exec rm -rf {} + \
 && rm -f linux/*/libonnxruntime_providers_cuda.so linux/*/libonnxruntime_providers_tensorrt.so \
 && rm -rf /app/node_modules/onnxruntime-web
# Download the small memory-search model once, so Max never needs to fetch it at runtime.
# Not fatal: without it memory search uses keywords (and retries the download on first use).
ARG EMBED_MODEL=Xenova/all-MiniLM-L6-v2
RUN node -e "const m=process.argv[1],fs=require('fs');(async()=>{for(const f of ['config.json','tokenizer.json','tokenizer_config.json','onnx/model_quantized.onnx']){const r=await fetch('https://huggingface.co/'+m+'/resolve/main/'+f);if(!r.ok)throw new Error(f+': '+r.status);const p='models/'+m+'/'+f;fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.from(await r.arrayBuffer()));}console.log('memory search model ready')})().catch(e=>{console.warn('memory search model not downloaded: '+e.message);fs.mkdirSync('models',{recursive:true})})" "$EMBED_MODEL"

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends alsa-utils libasound2-plugins pulseaudio-utils \
 && rm -rf /var/lib/apt/lists/*
# Route ALSA's "default" device (used by arecord/aplay) to the PulseAudio server in $PULSE_SERVER.
RUN printf 'pcm.!default { type pulse }\nctl.!default { type pulse }\n' > /etc/asound.conf
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/models ./models
COPY package.json ./
# Max's memory lives here (a Docker volume, so it survives restarts and rebuilds).
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "dist/main.js"]
