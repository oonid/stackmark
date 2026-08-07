# Release builder for the Debian package.
#
# Ubuntu 24.04 matches the KDE neon base the package targets, so the WebKitGTK
# and glibc versions the bundle links against are the ones it will meet on the
# host. Every tool is pinned here rather than taken from the host, which is why
# a host Tauri CLI at a different version does not affect the artifact.

# The Node runtime is copied from the official image rather than installed from
# a distribution repository, so it is the same build the other containers use.
FROM node:24.18.0-bookworm-slim AS node

FROM ubuntu:24.04

ARG HOST_UID=1000
ARG HOST_GID=1000

ENV DEBIAN_FRONTEND=noninteractive
ENV STACKEDIT_IN_BUILDER=1
ENV COREPACK_HOME=/opt/stackedit-corepack
ENV CARGO_HOME=/cargo
ENV RUSTUP_HOME=/rustup
ENV PATH=/cargo/bin:/usr/local/node/bin:$PATH

# Tauri 2 on Linux needs WebKitGTK 4.1 and the GTK/soup stack; dpkg-dev and
# fakeroot are what actually assemble the .deb.
RUN apt-get update \
  && apt-get install --no-install-recommends -y \
    build-essential \
    ca-certificates \
    curl \
    dpkg-dev \
    fakeroot \
    file \
    libayatana-appindicator3-dev \
    libgtk-3-dev \
    librsvg2-dev \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    libxdo-dev \
    patchelf \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/node/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/node/lib/node_modules
RUN ln -s /usr/local/node/lib/node_modules/corepack/dist/corepack.js /usr/local/node/bin/corepack \
  && chmod +x /usr/local/node/bin/corepack \
  && corepack enable --install-directory /usr/local/node/bin \
  && corepack prepare pnpm@11.20.0 --activate \
  && node --version | grep -Fx 'v24.18.0' \
  && pnpm --version | grep -Fx '11.20.0'

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain 1.88.0 --no-modify-path \
  && rustc --version | grep -F '1.88.0' \
  && cargo install tauri-cli@2.11.4 --locked \
  && cargo tauri --version

RUN groupadd --gid "$HOST_GID" --non-unique stackedit \
  && useradd --uid "$HOST_UID" --gid "$HOST_GID" --non-unique --create-home stackedit \
  && mkdir -p /workspace /cargo/registry /cargo/git \
  && chown -R stackedit:stackedit /workspace /cargo

USER stackedit
WORKDIR /workspace/apps/desktop
