import { NextResponse } from "next/server";

import type { GatewayResponse } from "./x402-gateway";

function corsHeaders(): HeadersInit {
  const origin = process.env.CORS_ORIGIN?.trim();
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function x402Options(): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export function toX402Response<T>(result: GatewayResponse<T>): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: corsHeaders(),
  });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid JSON body: ${msg}`);
  }
}
