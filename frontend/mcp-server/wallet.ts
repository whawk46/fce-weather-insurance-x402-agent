import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { weatherInsuranceAbi } from "@/lib/contracts";
import { CHAIN_ID, RPC_URL, WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import type { ContractExecute } from "@/lib/tee/private-buy";

const coston2Chain = {
  id: CHAIN_ID,
  name: "Coston2",
  nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

function normalizePrivateKey(): `0x${string}` {
  const raw = process.env.DEPLOYMENT_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error(
      "DEPLOYMENT_PRIVATE_KEY is not set. Add it to the repo .env or MCP server env.",
    );
  }
  return raw.startsWith("0x") ? (raw as `0x${string}`) : (`0x${raw}` as `0x${string}`);
}

let account: PrivateKeyAccount | null = null;
let walletClient: WalletClient | null = null;
let publicClient: PublicClient | null = null;

export function getMcpAccount(): PrivateKeyAccount {
  if (!account) {
    account = privateKeyToAccount(normalizePrivateKey());
  }
  return account;
}

export function getMcpPublicClient(): PublicClient {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: coston2Chain,
      transport: http(RPC_URL),
    });
  }
  return publicClient;
}

export function getMcpWalletClient(): WalletClient {
  if (!walletClient) {
    walletClient = createWalletClient({
      account: getMcpAccount(),
      chain: coston2Chain,
      transport: http(RPC_URL),
    });
  }
  return walletClient;
}

export function createMcpExecute(): ContractExecute {
  const wallet = getMcpWalletClient();
  const client = getMcpPublicClient();

  return async (config): Promise<TransactionReceipt> => {
    const hash = await wallet.writeContract({
      address: config.address,
      abi: config.abi,
      functionName: config.functionName,
      args: config.args,
      value: config.value,
      chain: coston2Chain,
      account: getMcpAccount(),
    });
    await client.waitForTransactionReceipt({ hash });
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error("Transaction reverted");
    }
    return receipt;
  };
}

/** Server-side equivalent of useEnsureExtensionReady (ContractSetup.tsx). */
export async function ensureExtensionReady(): Promise<void> {
  const client = getMcpPublicClient();
  const mcpAccount = getMcpAccount();

  try {
    await client.simulateContract({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "setExtensionId",
      account: mcpAccount,
    });
    const execute = createMcpExecute();
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
      const execute = createMcpExecute();
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

export function getMcpWalletAddress(): Address {
  return getMcpAccount().address;
}
