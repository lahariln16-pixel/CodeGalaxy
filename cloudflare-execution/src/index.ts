import { Files } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  FRONTEND_ORIGIN?: string;
}

type Output = { text: string; truncated: boolean };

const MAX_SOURCE_CHARS = 20_000;
const MAX_STDIN_CHARS = 8_000;
const MAX_BODY_BYTES = 32_000;
const MAX_OUTPUT_BYTES = 20_000;
const COMPILE_TIMEOUT_MS = 10_000;
const RUN_TIMEOUT_MS = 3_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

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
  if (!allowed.includes(origin)) throw new Error("Origin is not allowed.");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

async function readBodyLimited(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readStreamLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  controller: AbortController,
): Promise<Output> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.slice(0, remaining));
        total += Math.max(remaining, 0);
        truncated = true;
        controller.abort();
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // Aborting the process closes its output streams; keep the bounded output collected so far.
  } finally {
    try { reader.releaseLock(); } catch { /* stream already closed */ }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

async function collectProcess(
  process: { stdout: ReadableStream<Uint8Array> | null; stderr: ReadableStream<Uint8Array> | null; exitCode: Promise<number> },
  controller: AbortController,
): Promise<{ stdout: Output; stderr: Output; code: number }> {
  const [stdout, stderr, code] = await Promise.all([
    readStreamLimited(process.stdout, MAX_OUTPUT_BYTES, controller),
    readStreamLimited(process.stderr, MAX_OUTPUT_BYTES, controller),
    process.exitCode,
  ]);
  return { stdout, stderr, code };
}

function outputText(output: Output): string {
  return output.text + (output.truncated ? "\n[Output truncated at 20,000 bytes.]" : "");
}

export class RateLimiter extends DurableObject<Env> {
  async check(): Promise<boolean> {
    const now = Date.now();
    return this.ctx.storage.transaction(async (transaction) => {
      const saved = (await transaction.get<number[]>("timestamps")) ?? [];
      const recent = saved.filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
      if (recent.length >= RATE_LIMIT) {
        await transaction.put("timestamps", recent);
        return false;
      }
      recent.push(now);
      await transaction.put("timestamps", recent);
      return true;
    });
  }
}

export class Sandbox extends DurableObject<Env> {
  async execute(code: string, stdin: string): Promise<{
    language: string;
    version: string;
    compile: { stdout: string; stderr: string; code: number | null } | null;
    run: { stdout: string; stderr: string; code: number | null; signal: string | null } | null;
  }> {
    const container = this.ctx.container;
    if (!container) throw new Error("Container binding is not configured.");

    try {
      if (!container.running) {
        container.start({
          image: container.images.base,
          entrypoint: ["sleep", "infinity"],
          instance: "lite",
          enableInternet: false,
        });
      }

      const files = new Files(container);
      await files.writeFile("/tmp/main.c", code);

      const compileController = new AbortController();
      let compileTimedOut = false;
      const compileTimer = setTimeout(() => {
        compileTimedOut = true;
        compileController.abort();
      }, COMPILE_TIMEOUT_MS);

      let compiled: { stdout: Output; stderr: Output; code: number };
      try {
        const compiler = await container.exec([
          "/usr/bin/gcc", "-std=c17", "-O2", "-pipe",
          "-o", "/tmp/codegalaxy-program", "/tmp/main.c",
        ], { signal: compileController.signal });
        compiled = await collectProcess(compiler, compileController);
      } finally {
        clearTimeout(compileTimer);
      }

      if (compileTimedOut) {
        return {
          language: "c",
          version: "gcc-c17",
          compile: { stdout: outputText(compiled!.stdout), stderr: "Compilation timed out.", code: null },
          run: null,
        };
      }

      if (compiled.code !== 0 || compiled.stdout.truncated || compiled.stderr.truncated) {
        return {
          language: "c",
          version: "gcc-c17",
          compile: {
            stdout: outputText(compiled.stdout),
            stderr: outputText(compiled.stderr),
            code: compiled.code,
          },
          run: null,
        };
      }

      const runController = new AbortController();
      let runTimedOut = false;
      const runTimer = setTimeout(() => {
        runTimedOut = true;
        runController.abort();
      }, RUN_TIMEOUT_MS);

      let runResult: { stdout: Output; stderr: Output; code: number };
      try {
        const process = await container.exec(["/tmp/codegalaxy-program"], {
          stdin: "pipe",
          signal: runController.signal,
        });
        if (!process.stdin) throw new Error("Program stdin pipe was not available.");
        const writer = process.stdin.getWriter();
        try {
          await writer.write(new TextEncoder().encode(stdin));
        } finally {
          await writer.close().catch(() => undefined);
        }
        runResult = await collectProcess(process, runController);
      } finally {
        clearTimeout(runTimer);
      }

      return {
        language: "c",
        version: "gcc-c17",
        compile: {
          stdout: outputText(compiled.stdout),
          stderr: outputText(compiled.stderr),
          code: compiled.code,
        },
        run: {
          stdout: outputText(runResult.stdout),
          stderr: runTimedOut ? "Program exceeded the 3-second execution limit." : outputText(runResult.stderr),
          code: runTimedOut ? null : runResult.code,
          signal: null,
        },
      };
    } finally {
      // The DO identity remains available, but no files or processes survive this run.
      await container.destroy("CodeGalaxy execution completed").catch(() => undefined);
    }
  }
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
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "codegalaxy-cloudflare-execution" }, 200, headers);
    }
    if (request.method !== "POST" || url.pathname !== "/api/execute") {
      return json({ error: "Not found." }, 404, headers);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: "Request body is too large." }, 413, headers);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const limiterId = await hashIp(ip);
    const limiter = env.RATE_LIMITER.getByName(limiterId);
    if (!(await limiter.check())) {
      return json({ error: "Too many execution requests. Please wait a minute and try again." }, 429, {
        ...headers,
        "Retry-After": "60",
      });
    }

    let bodyText: string;
    try {
      bodyText = await readBodyLimited(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
        return json({ error: "Request body is too large." }, 413, headers);
      }
      return json({ error: "Could not read the request body." }, 400, headers);
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
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

    try {
      const sandboxId = `cg-${crypto.randomUUID()}`;
      const sandbox = env.Sandbox.getByName(sandboxId);
      const result = await sandbox.execute(code, stdin);
      return json(result, 200, headers);
    } catch {
      return json({
        error: "The isolated C sandbox could not complete this request. Check the Worker logs and try again.",
      }, 502, headers);
    }
  },
};
