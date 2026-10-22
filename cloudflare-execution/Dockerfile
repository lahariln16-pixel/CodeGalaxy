# Pin this image to the same release line as @cloudflare/sandbox.
FROM docker.io/cloudflare/sandbox:1.0.0

# GCC is used only inside a per-request, disposable Cloudflare container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev coreutils \
    && rm -rf /var/lib/apt/lists/*
