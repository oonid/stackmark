FROM node:24.18.0-bookworm-slim

ARG HOST_UID=1000
ARG HOST_GID=1000

ENV COREPACK_HOME=/opt/stackedit-corepack

RUN corepack enable \
  && corepack prepare pnpm@11.20.0 --activate \
  && node --version | grep -Fx 'v24.18.0' \
  && pnpm --version | grep -Fx '11.20.0' \
  && groupadd --gid "$HOST_GID" --non-unique stackedit \
  && useradd --uid "$HOST_UID" --gid "$HOST_GID" --non-unique --create-home --shell /bin/bash stackedit \
  && mkdir -p /workspace/node_modules /pnpm/store \
  && chown -R stackedit:stackedit /workspace /pnpm

USER stackedit
