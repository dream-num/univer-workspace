# The verify runner: one disposable Linux container per runner. runner/runner.mjs tags it by this file's hash.
# Same Debian release as apps/mcp/Dockerfile, so chromium and fonts match the MCP production image.
FROM node:24-bookworm
ENV DEBIAN_FRONTEND=noninteractive
# bookworm's python3-openpyxl 3.0.9 breaks seed-sales.py.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk fonts-liberation ffmpeg python3-pip lsof jq openssl \
    && pip3 install --break-system-packages openpyxl==3.1.5 \
    && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@11.24.0 agent-browser@0.42.0 @anthropic-ai/claude-code@2.1.331 && npm cache clean --force
# Every model slot is deepseek-flash: DeepSeek maps claude-opus* to a costlier model. The key arrives per task.
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic \
    ANTHROPIC_MODEL='deepseek-flash[1m]' ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-flash[1m]' \
    ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-flash[1m]' ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-flash \
    CLAUDE_CODE_SUBAGENT_MODEL=deepseek-flash CLAUDE_CODE_EFFORT_LEVEL=high \
    CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432
# The MCP journeys need opencode (npm's opencode-ai stops at 1.19.6), poppler, ImageMagick, uuidgen, sqlite3 (MP14's
# database lock), and a magick command, which bookworm's ImageMagick 6 lacks.
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils imagemagick uuid-runtime sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in arm64) asset=opencode-linux-arm64.tar.gz ;; amd64) asset=opencode-linux-x64-baseline.tar.gz ;; \
         *) echo "no opencode build for architecture '$TARGETARCH'" >&2; exit 1 ;; esac \
    && curl -fsSL "https://opencode.ai/files/bin/2.0.29/$asset" | tar -xz -C /usr/local/bin opencode \
    && printf '%s\n' '#!/bin/sh' \
      'case "$1" in identify|compare|composite|conjure|convert|mogrify|montage|stream) t=$1; shift; exec "$t" "$@";; esac' \
      'exec convert "$@"' >/usr/local/bin/magick \
    && chmod 755 /usr/local/bin/magick
# The dist start mode runs the MCP roles from apps/mcp/dist; verify-uvw allows it only where VERIFY_UVW_RUNNER=1.
# opencode's built-in deepseek provider reads DEEPSEEK_API_KEY, which each task receives.
ENV VERIFY_UVW_RUNNER=1 VERIFY_UVW_MCP_FROM=dist UNIVER_RENDER_BROWSER=/usr/bin/chromium \
    VERIFY_UVW_OPENCODE_MODEL='deepseek/deepseek-flash#high'
USER node
# Created here, a new named volume mounted on it belongs to node rather than root.
RUN mkdir -p /home/node/.local/share/pnpm
WORKDIR /home/node
