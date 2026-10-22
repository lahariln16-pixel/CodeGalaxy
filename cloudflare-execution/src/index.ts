import { getSandbox, type Sandbox as SandboxType } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<SandboxType>;
  FRONTEND_ORIGIN?: string;
}

const MAX_SOURCE_CHARS = 20_000;
const MAX_STDIN_CHARS = 8_000;
const MAX_OUTPUT_CHARS = 20_000;
const COMPILE_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 3_500;

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  const allowed = (env.FRONTEND_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!origin) return {};
  if (!allowed.includes(origin)) throw new Error("Origin is not allowed by CodeGalaxy.");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function clip(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_OUTPUT_CHARS) : "";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let headers: HeadersInit;
    try {
      headers = corsHeaders(request, env);
    } catch {
      return json({ error: "Origin is not allowed by CodeGalaxy." }, 403);
    }

    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "codegalaxy-cloudflare-execution" }, 200, headers);
    }
    if (request.method !== "POST" || url.pathname !== "/api/execute") {
      return json({ error: "Not found." }, 404, headers);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 32_000) {
      return json({ error: "Request body is too large." }, 413, headers);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400, headers);
    }
    if (!body || typeof body !== "object") {
      return json({ error: "Request body must be a JSON object." }, 400, headers);
    }

    const { code, stdin = "" } = body as { code?: unknown; stdin?: unknown };
    if (typeof code !== "string" || !code.trim()) {
      return json({ error: "Add some C source code before running it." }, 400, headers);
    }
    if (code.length > MAX_SOURCE_CHARS) {
      return json({ error: "Source code is too large (20,000 characters maximum)." }, 413, headers);
    }
    if (typeof stdin !== "string" || stdin.length > MAX_STDIN_CHARS) {
      return json({ error: "Program input must be text under 8,000 characters." }, 400, headers);
    }

    // Each execution receives its own disposable container so user programs cannot
    // collide with another request's files or processes.
    const sandbox = getSandbox(env.Sandbox, `cg-${crypto.randomUUID()}`, {
      sleepAfter: "30s",
    });

    try {
      await sandbox.writeFile("/tmp/main.c", code);
      await sandbox.writeFile("/tmp/stdin.txt", stdin);

      const compiler = await sandbox.exec([
        "/usr/bin/gcc",
        "-std=c17",
        "-O2",
        "-pipe",
        "-o",
        "/tmp/codegalaxy-program",
        "/tmp/main.c",
      ], { timeout: COMPILE_TIMEOUT_MS });

      const compiled = await compiler.output({
        encoding: "utf8",
        timeout: COMPILE_TIMEOUT_MS + 1_000,
        maxBytes: MAX_OUTPUT_CHARS,
      });

      if (compiled.timedOut) {
        return json({
          language: "c",
          version: "gcc-c17",
          compile: { stdout: clip(compiled.stdout), stderr: "Compilation timed out.", code: null },
          run: null,
        }, 200, headers);
      }

      if (compiled.exitCode !== 0) {
        return json({
          language: "c",
          version: "gcc-c17",
          compile: {
            stdout: clip(compiled.stdout),
            stderr: clip(compiled.stderr),
            code: compiled.exitCode,
          },
          run: null,
        }, 200, headers);
      }

      const execution = await sandbox.exec([
        "/bin/bash",
        "-lc",
        "exec /usr/bin/timeout --signal=KILL 3s /tmp/codegalaxy-program < /tmp/stdin.txt",
      ], { timeout: RUN_TIMEOUT_MS });

      const run = await execution.output({
        encoding: "utf8",
        timeout: RUN_TIMEOUT_MS + 1_000,
        maxBytes: MAX_OUTPUT_CHARS,
      });

      return json({
        language: "c",
        version: "gcc-c17",
        compile: {
          stdout: clip(compiled.stdout),
          stderr: clip(compiled.stderr),
          code: compiled.exitCode,
        },
        run: {
          stdout: clip(run.stdout),
          stderr: clip(run.stderr),
          code: run.timedOut ? null : run.exitCode,
          signal: run.signal == null ? null : String(run.signal),
        },
      }, 200, headers);
    } catch {
      return json({
        error: "The isolated C sandbox could not complete this request. Try again, or check the Worker logs.",
      }, 502, headers);
    } finally {
      // Free container resources and erase all source, input, binaries, and processes.
      try {
        await sandbox.destroy();
      } catch {
        // Preserve the execution response; Cloudflare may already have stopped the container.
      }
    }
  },
};
