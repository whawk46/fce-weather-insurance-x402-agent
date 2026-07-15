import type { Address } from "viem";

import { erc20Abi } from "@/lib/abi/erc20";
import { X402_GATEWAY_URL } from "@/lib/config";

import type { ContractExecute } from "./private-buy";

/**
 * Body of a 402 response from the x402 gateway (Next.js /x402/weather/* routes).
 * Approve `amountBase` of `asset` to `spender` (the WeatherInsurance contract
 * itself — it pulls the fee via transferFrom when the gateway relays the
 * request), then retry. The gateway's pre-check here is a convenience; the
 * contract's own transferFrom is what actually enforces payment.
 */
export type PaymentRequirements = {
  x402Version: number;
  resource: string;
  chainId: number;
  asset: Address;
  spender: Address;
  amountBase: string;
  currentAllowanceBase: string;
};

type GatewayError = { error: string };

function isPaymentRequirements(body: unknown): body is PaymentRequirements {
  return (
    !!body &&
    typeof body === "object" &&
    "spender" in body &&
    "amountBase" in body &&
    "asset" in body
  );
}

/**
 * x402 handshake against the payment gateway: POST the request (with `payer`
 * = the connected wallet), and on a 402 response approve the requested
 * feeToken amount to the WeatherInsurance contract before retrying. Mirrors
 * the server-side requirePayment check in lib/server/x402-gateway.ts.
 */
export async function payAndFetch<T>(
  resource: string,
  body: Record<string, unknown>,
  execute: ContractExecute,
  onStep?: (label: string) => void,
): Promise<T> {
  const url = `${X402_GATEWAY_URL}${resource}`;

  onStep?.("Requesting…");
  const first = await postJSON(url, body);
  if (first.status !== 402) {
    return handleFinalResponse<T>(first);
  }

  const requirements = (await first.json()) as PaymentRequirements;
  if (!isPaymentRequirements(requirements)) {
    throw new Error("Gateway returned an invalid 402 payment-required body");
  }

  onStep?.(`Approving ${formatFeeBase(requirements.amountBase)} feeToken units…`);
  await execute({
    address: requirements.asset,
    abi: erc20Abi,
    functionName: "approve",
    args: [requirements.spender, BigInt(requirements.amountBase)],
  });

  onStep?.("Approved, retrying request…");
  const second = await postJSON(url, body);
  return handleFinalResponse<T>(second);
}

function postJSON(url: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function handleFinalResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as GatewayError | null;
    throw new Error(body?.error ?? `Gateway request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Base-unit amounts aren't necessarily 18 decimals (FXRP is 6) — show the raw base amount. */
function formatFeeBase(amountBase: string): string {
  return amountBase;
}
