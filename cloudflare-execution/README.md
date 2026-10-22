# CodeGalaxy C execution on Cloudflare

This folder contains a Cloudflare Worker API and a disposable Cloudflare Sandbox container with GCC. It implements the same `POST /api/execute` response contract used by `src/services/executeC.ts`.

## Requirements

- A Cloudflare account with the **Workers Paid** plan enabled. Cloudflare Sandboxes/Containers are not available on the Free plan.
- Node.js 20+ and npm.
- Docker running locally. Wrangler builds the sandbox image during local development and deployment.
- Access to authorize Wrangler against your Cloudflare account in a browser.

## Deploy

From this folder:

```bash
npm install
npx wrangler login
```

Set `FRONTEND_ORIGIN` in `wrangler.jsonc` to the exact deployed frontend origin (for example, `https://codegalaxy.example`). Do not use a wildcard origin for the public app.

Then deploy:

```bash
npm run deploy
```

The first image build and container provisioning can take several minutes. Wrangler prints the Worker URL, usually `https://codegalaxy-c-execution.<your-subdomain>.workers.dev`.

Check health:

```bash
curl https://YOUR-WORKER-URL/health
```

Configure the frontend build environment variable to point at the Worker:

```bash
VITE_EXECUTION_API_URL=https://YOUR-WORKER-URL/api/execute
```

For a Cloudflare Pages build, add that variable in the Pages project's Settings → Environment variables, then redeploy the frontend. If the frontend itself is a Worker, set the same variable in that project's build configuration.

## Security and operational checklist

- This Worker creates a unique sandbox ID for every execution and destroys the container in a `finally` block. Do not change this to a shared sandbox ID: arbitrary C programs can create processes and modify files.
- The sandbox image is built from Cloudflare's Sandbox SDK preview line and installs GCC. Keep the `@cloudflare/sandbox@next` package and `cloudflare/sandbox:next` image on the same release line.
- The API caps source at 20,000 characters, stdin at 8,000 characters, compiler/runtime time, and buffered output. It only exposes C compilation/execution and has a health endpoint.
- Before public launch, add a Cloudflare rate-limiting rule for `POST /api/execute` and configure abuse monitoring in the Cloudflare dashboard. Worker-level in-memory counters are not a reliable distributed rate limiter.
- Review current Cloudflare Containers limits and pricing before public traffic. Each request creates and destroys a container; do not launch publicly until concurrency and cost limits are set.
- C programs are untrusted. Do not add credentials, persistent user data, or other secrets to the container image.
- `@cloudflare/sandbox@next` is a preview dependency. Verify the SDK/image compatibility and run compile, stdin, compiler-error, timeout, and concurrent-request integration tests before production use.

## Local development

```bash
npm install
npx wrangler dev
```

Docker must be running locally. Test the Worker using the local URL Wrangler prints (normally `http://localhost:8787`).
