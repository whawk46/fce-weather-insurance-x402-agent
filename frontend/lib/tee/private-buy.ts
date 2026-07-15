import type { Abi, Address, Hash, PublicClient, TransactionReceipt } from "viem";

import { weatherInsuranceAbi } from "@/lib/contracts";
import {
  INSTRUCTION_FEE_WEI,
  WEATHER_INSURANCE_ADDRESS,
} from "@/lib/config";

import {
  formatLiquidityError,
  liquidityCoversPayout,
  readAvailableLiquidity,
} from "@/lib/pool";

import { buildPrivateBuyCiphertext } from "./ecies";
import { parseInstructionIdFromReceipt } from "./instruction";
import {
  actionResultFields,
  fetchTeeInfo,
  pollActionResult,
} from "./proxy";
import type { ActionResponse } from "./types";

/** Policy terms for a private buy (matches Go RequestAndRelayPrivateBuy inputs). */
export type PrivateBuyTerms = {
  holder: Address;
  contractAddr?: Address;
  date: string;
  rainThresholdMmE2: bigint;
  payout: bigint;
  premium: bigint;
  lat: string;
  lon: string;
};

export type RequestAndRelayPrivateBuyResult = {
  instructionId: Hash;
  actionResponse: ActionResponse;
  buyReceipt: TransactionReceipt;
  relayReceipt: TransactionReceipt;
};

/** Wallet write helper (same contract surface as useTx.execute). */
export type ContractExecute = (config: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}) => Promise<TransactionReceipt>;

/**
 * Private buy flow: fetch TEE key → ECIES encrypt → buyPolicyPrivate → poll proxy → relayPrivateBuy.
 * Mirrors tools/pkg/utils RequestAndRelayPrivateBuy.
 */
export async function requestAndRelayPrivateBuy(
  terms: PrivateBuyTerms,
  execute: ContractExecute,
  onStep?: (label: string) => void,
  publicClient?: PublicClient | null,
): Promise<RequestAndRelayPrivateBuyResult> {
  const contractAddr = terms.contractAddr ?? WEATHER_INSURANCE_ADDRESS;

  if (publicClient) {
    const available = await readAvailableLiquidity(publicClient, contractAddr);
    if (!liquidityCoversPayout(available, terms.payout, terms.premium)) {
      throw new Error(formatLiquidityError(available, terms.payout, terms.premium));
    }
  }

  onStep?.("Fetching TEE public key…");
  const info = await fetchTeeInfo();
  const machineKey = info.machineData?.publicKey;
  if (!machineKey?.x || !machineKey?.y) {
    throw new Error("TEE machine public key missing from /info");
  }

  onStep?.("Encrypting policy terms (ECIES)…");
  const ciphertext = await buildPrivateBuyCiphertext(
    machineKey,
    terms.holder,
    contractAddr,
    terms.date,
    terms.rainThresholdMmE2,
    terms.payout,
    terms.premium,
    terms.lat,
    terms.lon,
  );

  onStep?.("Submitting private buy to TEE…");
  const buyReceipt = await execute({
    address: contractAddr,
    abi: weatherInsuranceAbi,
    functionName: "buyPolicyPrivate",
    args: [ciphertext],
    value: INSTRUCTION_FEE_WEI,
  });

  const instructionId = parseInstructionIdFromReceipt(buyReceipt);
  if (!instructionId) {
    throw new Error("Could not parse instruction ID from receipt");
  }

  onStep?.("Waiting for TEE (private buy)…");
  const actionResponse = await pollActionResult(instructionId);
  if (actionResponse.result.status !== 1) {
    throw new Error(actionResponse.result.log ?? "TEE reported failure");
  }

  const { data, signature, actionId, submissionTag, status } =
    actionResultFields(actionResponse);

  if (publicClient) {
    const available = await readAvailableLiquidity(publicClient, contractAddr);
    if (!liquidityCoversPayout(available, terms.payout, terms.premium)) {
      throw new Error(formatLiquidityError(available, terms.payout, terms.premium));
    }
  }

  onStep?.("Relaying private buy on-chain…");
  const relayReceipt = await execute({
    address: contractAddr,
    abi: weatherInsuranceAbi,
    functionName: "relayPrivateBuy",
    args: [data, actionId, submissionTag, status, signature],
  });

  return {
    instructionId,
    actionResponse,
    buyReceipt,
    relayReceipt,
  };
}
