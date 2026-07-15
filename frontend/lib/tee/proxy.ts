import type { ActionResponse, TeeInfoResponse } from "./types";

// Browser code has a document origin to resolve "/api/tee/*" against, so it
// goes through the Next.js API routes. Standalone Node processes (e.g. the
// MCP server) have no such origin, so they talk to the extension proxy
// directly via EXT_PROXY_URL.
const IS_BROWSER = typeof window !== "undefined";

const ACTION_POLL_MAX_ATTEMPTS = 20;
const ACTION_POLL_RETRY_MS = 2000;

export async function fetchTeeInfo(): Promise<TeeInfoResponse> {
  if (IS_BROWSER) {
    const res = await fetch("/api/tee/info");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TEE info failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<TeeInfoResponse>;
  }

  const { proxyGet } = await import("@/lib/server/tee-proxy");
  const result = await proxyGet("/info");
  if (!result.ok) throw new Error(result.message);
  return result.data as TeeInfoResponse;
}

export async function pollActionResult(
  instructionId: string,
): Promise<ActionResponse> {
  if (IS_BROWSER) {
    const res = await fetch(
      `/api/tee/action/${instructionId.replace(/^0x/, "")}`,
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Action result failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<ActionResponse>;
  }

  const { proxyGet } = await import("@/lib/server/tee-proxy");
  const path = `/action/result/${instructionId.startsWith("0x") ? instructionId : `0x${instructionId}`}`;

  let lastError = "Action result not ready";
  for (let attempt = 0; attempt < ACTION_POLL_MAX_ATTEMPTS; attempt++) {
    const result = await proxyGet(path);
    if (result.ok) {
      const payload = result.data as ActionResponse;
      const status = payload?.result?.status;
      if (status === 1) return payload;
      lastError =
        payload?.result?.log ??
        (status === 2 ? "TEE action in progress" : "TEE action failed");
    } else {
      lastError = result.message;
    }
    await new Promise((r) => setTimeout(r, ACTION_POLL_RETRY_MS));
  }

  throw new Error(`${lastError} (polled ${ACTION_POLL_MAX_ATTEMPTS} times)`);
}

export function actionResultFields(resp: ActionResponse) {
  const data = resp.result.data;
  const signature = resp.signature;
  const actionId = resp.result.id;
  const submissionTag = resp.result.submissionTag;
  const status = resp.result.status;
  return { data, signature, actionId, submissionTag, status };
}
