import { handleSettle } from "@/lib/server/x402-gateway";
import {
  readJsonBody,
  toX402Response,
  x402Options,
} from "@/lib/server/x402-route";

export const maxDuration = 120;

export function OPTIONS() {
  return x402Options();
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const result = await handleSettle(body);
    return toX402Response(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return toX402Response({ status: 400, body: { error: msg } });
  }
}
