import { weatherInsuranceAbi } from "@/lib/contracts";
import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import type { ContractExecute } from "@/lib/tee/private-buy";
import {
  createGatewayExecute,
  getGatewayAccount,
  getGatewayPublicClient,
  getGatewayWalletAddress,
  getGatewayWalletClient,
} from "@/lib/server/gateway-wallet";

export {
  createGatewayExecute,
  getGatewayAccount,
  getGatewayPublicClient,
  getGatewayWalletAddress,
  getGatewayWalletClient,
};

export const getMcpAccount = getGatewayAccount;
export const getMcpPublicClient = getGatewayPublicClient;
export const getMcpWalletClient = getGatewayWalletClient;
export const createMcpExecute = createGatewayExecute;
export const getMcpWalletAddress = getGatewayWalletAddress;

/** Server-side equivalent of useEnsureExtensionReady (ContractSetup.tsx). */
export async function ensureExtensionReady(): Promise<void> {
  const client = getGatewayPublicClient();
  const account = getGatewayAccount();

  try {
    await client.simulateContract({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "setExtensionId",
      account,
    });
    const execute = createGatewayExecute();
    await execute({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "setExtensionId",
    });
    return;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Extension ID already set")) return;
    if (msg.includes("Extension ID not found")) {
      throw new Error(
        "Extension not registered on-chain. Run ./scripts/pre-build.sh first.",
      );
    }
    if (msg.includes("Extension ID is not set")) {
      const execute = createGatewayExecute();
      await execute({
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "setExtensionId",
      });
      return;
    }
    throw e;
  }
}

export type { ContractExecute };
