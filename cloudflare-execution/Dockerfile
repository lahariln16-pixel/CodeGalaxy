# Keep the image on the same preview line as @cloudflare/sandbox@next.
FROM docker.io/cloudflare/sandbox:next

# GCC is used only inside the per-request Cloudflare sandbox container.
# The container is destroyed after each request to prevent cross-run state.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libc6-dev coreutils \
    && rm -rf /var/lib/apt/lists/*
