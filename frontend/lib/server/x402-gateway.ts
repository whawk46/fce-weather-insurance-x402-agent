import {
  decodeAbiParameters,
  type Address,
  type Hex,
  zeroAddress,
} from "viem";

import { erc20Abi } from "@/lib/abi/erc20";
import { weatherInsuranceAbi } from "@/lib/contracts";
import {
  CHAIN_ID,
  INSTRUCTION_FEE_WEI,
  WEATHER_INSURANCE_ADDRESS,
} from "@/lib/config";
import {
  decodeWeatherReport,
  parseInstructionIdFromReceipt,
  type WeatherReport,
} from "@/lib/tee/instruction";
import {
  actionResultFields,
  pollActionResult,
} from "@/lib/tee/proxy";
import type { PaymentRequirements } from "@/lib/tee/x402";

import { createGatewayExecute, getGatewayPublicClient } from "./gateway-wallet";

export const FETCH_RESOURCE = "/x402/weather/fetch";
export const SETTLE_RESOURCE = "/x402/weather/settle";

export type GatewayErrorBody = { error: string };

export type GatewayResponse<T> =
  | { status: 200; body: T }
  | { status: 402; body: PaymentRequirements }
  | { status: 400 | 500 | 502; body: GatewayErrorBody };

export type FetchSuccessBody = {
  instructionId: string;
  requestTx: `0x${string}`;
  report: WeatherReport;
};

export type SettleSuccessBody = {
  settleTx: `0x${string}`;
  precipitationMmE2: string;
  date: string;
  revealedThresholdMmE2: string;
  triggered: boolean;
};

const settlementResultAbi = [
  { type: "address" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "string" },
  { type: "uint256" },
  { type: "bool" },
] as const;

export function buildPaymentRequirements(
  resource: string,
  feeToken: Address,
  spender: Address,
  amount: bigint,
  currentAllowance: bigint,
): PaymentRequirements {
  return {
    x402Version: 1,
    resource,
    chainId: CHAIN_ID,
    asset: feeToken,
    spender,
    amountBase: amount.toString(),
    currentAllowanceBase: currentAllowance.toString(),
  };
}

export function parseFetchRequest(
  body: unknown,
): { ok: true; city: string; payer: Address } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid JSON body" };
  }
  const record = body as Record<string, unknown>;
  const city = typeof record.city === "string" ? record.city.trim() : "";
  const payer =
    typeof record.payer === "string" ? (record.payer as Address) : zeroAddress;

  if (!city) {
    return { ok: false, error: "city is required" };
  }
  if (payer === zeroAddress) {
    return { ok: false, error: "payer is required" };
  }
  return { ok: true, city, payer };
}

export function parseSettleRequest(
  body: unknown,
):
  | { ok: true; policyId: bigint; payer: Address }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "invalid JSON body" };
  }
  const record = body as Record<string, unknown>;
  const policyIdRaw =
    typeof record.policyId === "string"
      ? record.policyId
      : typeof record.policyId === "number"
        ? String(record.policyId)
        : "";
  const payer =
    typeof record.payer === "string" ? (record.payer as Address) : zeroAddress;

  if (!policyIdRaw || !/^\d+$/.test(policyIdRaw)) {
    return {
      ok: false,
      error: "policyId is required and must be a base-10 integer string",
    };
  }
  if (payer === zeroAddress) {
    return { ok: false, error: "payer is required" };
  }
  return { ok: true, policyId: BigInt(policyIdRaw), payer };
}

export function decodeSettlementResultData(data: Hex): {
  precipitationMmE2: bigint;
  date: string;
  revealedThresholdMmE2: bigint;
  triggered: boolean;
} {
  const [
    ,
    ,
    precipitationMmE2,
    date,
    revealedThresholdMmE2,
    triggered,
  ] = decodeAbiParameters(settlementResultAbi, data);

  return {
    precipitationMmE2,
    date,
    revealedThresholdMmE2,
    triggered,
  };
}

export async function requirePayment(
  payer: Address,
  amount: bigint,
  resource: string,
): Promise<GatewayResponse<never> | null> {
  if (amount === 0n) {
    return null;
  }

  const client = getGatewayPublicClient();

  let feeToken: Address;
  try {
    feeToken = (await client.readContract({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "feeToken",
    })) as Address;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 500, body: { error: `reading feeToken: ${msg}` } };
  }

  let allowance: bigint;
  try {
    allowance = await client.readContract({
      address: feeToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [payer, WEATHER_INSURANCE_ADDRESS],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 500, body: { error: `reading allowance: ${msg}` } };
  }

  if (allowance >= amount) {
    return null;
  }

  return {
    status: 402,
    body: buildPaymentRequirements(
      resource,
      feeToken,
      WEATHER_INSURANCE_ADDRESS,
      amount,
      allowance,
    ),
  };
}

export async function handleFetch(
  body: unknown,
): Promise<GatewayResponse<FetchSuccessBody>> {
  const parsed = parseFetchRequest(body);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } };
  }

  const client = getGatewayPublicClient();
  const execute = createGatewayExecute();

  let fetchFee: bigint;
  try {
    fetchFee = (await client.readContract({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "fetchFee",
    })) as bigint;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 500, body: { error: `reading fetchFee: ${msg}` } };
  }

  const paymentBlock = await requirePayment(parsed.payer, fetchFee, FETCH_RESOURCE);
  if (paymentBlock) {
    return paymentBlock;
  }

  let requestReceipt;
  try {
    requestReceipt = await execute({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "getWeather",
      args: [parsed.city, parsed.payer],
      value: INSTRUCTION_FEE_WEI,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 502, body: { error: `sendGetWeather: ${msg}` } };
  }

  const instructionId = parseInstructionIdFromReceipt(requestReceipt);
  if (!instructionId) {
    return {
      status: 502,
      body: { error: "sendGetWeather: could not parse instruction ID from receipt" },
    };
  }

  let actionResponse;
  try {
    actionResponse = await pollActionResult(instructionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 502, body: { error: `poll fetch result: ${msg}` } };
  }

  if (actionResponse.result.status !== 1) {
    return {
      status: 502,
      body: {
        error: `TEE FETCH failed: ${actionResponse.result.log ?? "unknown error"}`,
      },
    };
  }

  const report = decodeWeatherReport(actionResponse.result.data);
  if (!report) {
    return { status: 500, body: { error: "decoding weather report" } };
  }

  return {
    status: 200,
    body: {
      instructionId,
      requestTx: requestReceipt.transactionHash,
      report,
    },
  };
}

export async function handleSettle(
  body: unknown,
): Promise<GatewayResponse<SettleSuccessBody>> {
  const parsed = parseSettleRequest(body);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } };
  }

  const client = getGatewayPublicClient();
  const execute = createGatewayExecute();

  let settleFee: bigint;
  try {
    settleFee = (await client.readContract({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "settleFee",
    })) as bigint;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 500, body: { error: `reading settleFee: ${msg}` } };
  }

  const paymentBlock = await requirePayment(
    parsed.payer,
    settleFee,
    SETTLE_RESOURCE,
  );
  if (paymentBlock) {
    return paymentBlock;
  }

  let requestReceipt;
  try {
    requestReceipt = await execute({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "requestSettlement",
      args: [parsed.policyId, parsed.payer],
      value: INSTRUCTION_FEE_WEI,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 502, body: { error: `requestSettlement: ${msg}` } };
  }

  const instructionId = parseInstructionIdFromReceipt(requestReceipt);
  if (!instructionId) {
    return {
      status: 502,
      body: {
        error: "requestSettlement: could not parse instruction ID from receipt",
      },
    };
  }

  let actionResponse;
  try {
    actionResponse = await pollActionResult(instructionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 502, body: { error: `poll settlement result: ${msg}` } };
  }

  if (actionResponse.result.status !== 1) {
    return {
      status: 502,
      body: {
        error: `TEE settlement failed: ${actionResponse.result.log ?? "unknown error"}`,
      },
    };
  }

  const { data, signature, actionId, submissionTag, status } =
    actionResultFields(actionResponse);

  let settleReceipt;
  try {
    settleReceipt = await execute({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "settle",
      args: [data, actionId, submissionTag, status, signature],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 502, body: { error: `relay settle: ${msg}` } };
  }

  let settlement;
  try {
    settlement = decodeSettlementResultData(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 500, body: { error: `decoding settlement result: ${msg}` } };
  }

  return {
    status: 200,
    body: {
      settleTx: settleReceipt.transactionHash,
      precipitationMmE2: settlement.precipitationMmE2.toString(),
      date: settlement.date,
      revealedThresholdMmE2: settlement.revealedThresholdMmE2.toString(),
      triggered: settlement.triggered,
    },
  };
}
