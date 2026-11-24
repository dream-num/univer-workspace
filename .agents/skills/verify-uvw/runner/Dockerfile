# The verify runner: one disposable Linux container per runner. bin/runner.mjs tags it by this file's hash.
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
USER node
# Created here, a new named volume mounted on it belongs to node rather than root.
RUN mkdir -p /home/node/.local/share/pnpm
WORKDIR /home/node
