import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";

const app = express();
const port = Number(process.env.PORT || 8787);
const pistonUrl = process.env.PISTON_API_URL || "http://localhost:2000/api/v2/execute";
const cVersion = process.env.PISTON_C_VERSION || "10.2.0";
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    // Allow command-line health checks, but only configured browser origins.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CodeGalaxy."));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json({ limit: "32kb", strict: true }));
app.use("/api/", rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many execution requests. Please wait a minute and try again." },
}));

app.get("/health", (_req, res) => res.json({ ok: true, service: "codegalaxy-execution-api" }));

app.post("/api/execute", async (req, res) => {
  const { code, stdin = "" } = req.body ?? {};
  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "Add some C source code before running it." });
  }
  if (code.length > 20_000) {
    return res.status(413).json({ error: "Source code is too large (20,000 characters maximum)." });
  }
  if (typeof stdin !== "string" || stdin.length > 8_000) {
    return res.status(400).json({ error: "Program input must be text under 8,000 characters." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const upstream = await fetch(pistonUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        language: "c",
        version: cVersion,
        files: [{ name: "main.c", content: code }],
        stdin,
        compile_timeout: 10_000,
        run_timeout: 3_000,
        compile_memory_limit: 128_000_000,
        run_memory_limit: 128_000_000,
      }),
    });

    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return res.status(502).json({
        error: payload?.message || "The sandbox rejected the execution request.",
      });
    }
    if (!payload || typeof payload !== "object") {
      return res.status(502).json({ error: "The sandbox returned an invalid response." });
    }

    const compile = payload.compile ?? null;
    const run = payload.run ?? null;
    const clip = (value) => typeof value === "string" ? value.slice(0, 20_000) : "";
    return res.json({
      language: payload.language || "c",
      version: payload.version || cVersion,
      compile: compile ? {
        stdout: clip(compile.stdout),
        stderr: clip(compile.stderr),
        code: compile.code ?? null,
      } : null,
      run: run ? {
        stdout: clip(run.stdout),
        stderr: clip(run.stderr),
        code: run.code ?? null,
        signal: run.signal ?? null,
      } : null,
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? "The sandbox took too long to respond. Try a smaller program."
        : "Could not reach the C sandbox. Check PISTON_API_URL and make sure the sandbox is running.",
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large." });
  }
  if (error instanceof SyntaxError) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  return res.status(400).json({ error: error?.message || "Invalid request." });
});

app.listen(port, () => {
  console.log(`CodeGalaxy execution API listening on http://localhost:${port}`);
});
