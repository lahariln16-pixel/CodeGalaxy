export type CExecutionResult = {
  language?: string;
  version?: string;
  compile?: { stdout: string; stderr: string; code: number | null } | null;
  run?: { stdout: string; stderr: string; code: number | null; signal: string | null } | null;
  error?: string;
};

const endpoint = import.meta.env.VITE_EXECUTION_API_URL || "http://localhost:8787/api/execute";

export async function executeC(source: string, stdin = ""): Promise<CExecutionResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: source, stdin }),
  });
  const result = await response.json().catch(() => ({})) as CExecutionResult;
  if (!response.ok) {
    throw new Error(result.error || `Execution service returned HTTP ${response.status}.`);
  }
  return result;
}
