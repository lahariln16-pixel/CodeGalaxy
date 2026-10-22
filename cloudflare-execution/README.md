# CodeGalaxy C execution on Cloudflare

This folder contains a Cloudflare Worker API and a disposable Cloudflare Container with GCC. It implements the same `POST /api/execute` response contract used by `src/services/executeC.ts`.

## Requirements

- A Cloudflare account with the **Workers Paid** plan enabled. Cloudflare Containers/Sandboxes are not available on the Free plan.
- Node.js 20+ and npm.
- Docker running locally. Wrangler builds the container image during local development and deployment.
- Browser access to authorize Wrangler against your Cloudflare account.

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

For a Cloudflare Pages build, add that variable in the Pages project's Settings → Environment variables, then redeploy the frontend.

## Security and operations

- Each execution gets a unique Durable Object and container. The Worker destroys the container after compilation/execution, so files and processes do not persist between runs.
- The container starts with `enableInternet: false`; user C programs cannot make outbound internet connections.
- A Durable Object-backed rate limiter allows at most 20 requests per minute per Cloudflare client IP. Source, stdin, request body, output size, compilation time, and run time are capped.
- The container runs arbitrary untrusted C. Do not add credentials, persistent user data, or other secrets to its image.
- Review current Cloudflare Containers limits and pricing before public traffic. The container deployment and end-to-end behavior still need to be tested in your Cloudflare account.
- This worker uses Cloudflare Sandbox SDK 1.0.0 and the matching container image. Keep them on the same release line.

## Local development

```bash
npm install
npx wrangler dev
```

Docker must be running locally. Test the Worker using the local URL Wrangler prints (normally `http://localhost:8787`).
