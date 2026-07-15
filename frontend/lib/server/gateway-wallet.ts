import "./env";

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

import { CHAIN_ID, RPC_URL } from "@/lib/config";
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
      "DEPLOYMENT_PRIVATE_KEY is not set. Add it to the repo .env or frontend/.env.local.",
    );
  }
  return raw.startsWith("0x") ? (raw as `0x${string}`) : (`0x${raw}` as `0x${string}`);
}

let account: PrivateKeyAccount | null = null;
let walletClient: WalletClient | null = null;
let publicClient: PublicClient | null = null;

export function getGatewayAccount(): PrivateKeyAccount {
  if (!account) {
    account = privateKeyToAccount(normalizePrivateKey());
  }
  return account;
}

export function getGatewayPublicClient(): PublicClient {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: coston2Chain,
      transport: http(RPC_URL),
    });
  }
  return publicClient;
}

export function getGatewayWalletClient(): WalletClient {
  if (!walletClient) {
    walletClient = createWalletClient({
      account: getGatewayAccount(),
      chain: coston2Chain,
      transport: http(RPC_URL),
    });
  }
  return walletClient;
}

export function createGatewayExecute(): ContractExecute {
  const wallet = getGatewayWalletClient();
  const client = getGatewayPublicClient();

  return async (config): Promise<TransactionReceipt> => {
    const hash = await wallet.writeContract({
      address: config.address,
      abi: config.abi,
      functionName: config.functionName,
      args: config.args,
      value: config.value,
      chain: coston2Chain,
      account: getGatewayAccount(),
    });
    await client.waitForTransactionReceipt({ hash });
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error("Transaction reverted");
    }
    return receipt;
  };
}

export function getGatewayWalletAddress(): Address {
  return getGatewayAccount().address;
}
