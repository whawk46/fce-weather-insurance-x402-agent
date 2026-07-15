import { getAbiItem, toEventSelector, type Address, type Hash } from "viem";

import { weatherInsuranceAbi } from "@/lib/contracts";
import { EXPLORER_API_URL } from "@/lib/config";

type ExplorerLog = {
  topics: string[];
  transactionHash: string;
};

function eventTopic0(name: "PolicyBought" | "PrivatePolicyRelayed" | "Settled"): Hash {
  const item = getAbiItem({ abi: weatherInsuranceAbi, name });
  if (!item || item.type !== "event") {
    throw new Error(`Missing ABI event: ${name}`);
  }
  return toEventSelector(item);
}

async function fetchExplorerLogs(
  address: Address,
  topic0: Hash,
  fromBlock: bigint,
): Promise<ExplorerLog[]> {
  const url = new URL(EXPLORER_API_URL);
  url.searchParams.set("module", "logs");
  url.searchParams.set("action", "getLogs");
  url.searchParams.set("address", address);
  url.searchParams.set("fromBlock", fromBlock.toString());
  url.searchParams.set("toBlock", "latest");
  url.searchParams.set("topic0", topic0);

  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as { status?: string; result?: ExplorerLog[] };
  if (body.status !== "1" || !Array.isArray(body.result)) {
    return [];
  }
  return body.result;
}

async function resolveDeployBlock(address: Address): Promise<bigint> {
  const fromEnv = process.env.CONTRACT_DEPLOY_BLOCK?.trim();
  if (fromEnv) return BigInt(fromEnv);

  const url = new URL(EXPLORER_API_URL);
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getcontractcreation");
  url.searchParams.set("contractaddresses", address);

  const res = await fetch(url, { next: { revalidate: 3600 } });
  const body = (await res.json()) as {
    status?: string;
    result?: { blockNumber?: string }[];
  };
  const block = body.result?.[0]?.blockNumber;
  if (!block) {
    throw new Error(`Could not resolve deploy block for ${address}`);
  }
  return BigInt(block);
}

function logsToMap(logs: ExplorerLog[]): Record<string, Hash> {
  const map: Record<string, Hash> = {};
  for (const log of logs) {
    const topic = log.topics[1];
    if (!topic || !log.transactionHash) continue;
    map[BigInt(topic).toString()] = log.transactionHash as Hash;
  }
  return map;
}

export type PolicyTxHashMaps = {
  buy: Record<string, Hash>;
  settle: Record<string, Hash>;
};

/** Fetches buy + settle tx hashes via Blockscout (Coston2 RPC limits eth_getLogs to 30 blocks). */
export async function fetchPolicyTxHashes(
  address: Address,
): Promise<PolicyTxHashMaps> {
  const fromBlock = await resolveDeployBlock(address);

  const [publicBuys, privateRelays, settlements] = await Promise.all([
    fetchExplorerLogs(address, eventTopic0("PolicyBought"), fromBlock),
    fetchExplorerLogs(address, eventTopic0("PrivatePolicyRelayed"), fromBlock),
    fetchExplorerLogs(address, eventTopic0("Settled"), fromBlock),
  ]);

  const buy = {
    ...logsToMap(publicBuys),
    ...logsToMap(privateRelays),
  };

  return { buy, settle: logsToMap(settlements) };
}
