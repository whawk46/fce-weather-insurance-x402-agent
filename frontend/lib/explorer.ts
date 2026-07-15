import {
  decodeEventLog,
  keccak256,
  parseAbiItem,
  toHex,
  type Hex,
} from "viem";

const settledEvent = parseAbiItem(
  "event Settled(uint256 indexed policyId, uint256 measuredMmE2, bool paidOut)",
);

export const SETTLED_EVENT_TOPIC = keccak256(
  toHex("Settled(uint256,uint256,bool)"),
);

type ExplorerLog = {
  transactionHash: string;
  topics: (string | null)[];
  data: string;
};

export type SettledLog = {
  policyId: bigint;
  paidOut: boolean;
  transactionHash: `0x${string}`;
};

export function parseSettledExplorerLog(log: ExplorerLog): SettledLog {
  const topics = log.topics.filter((t): t is string => t != null) as [
    Hex,
    ...Hex[],
  ];
  const decoded = decodeEventLog({
    abi: [settledEvent],
    data: log.data as Hex,
    topics,
  });

  return {
    policyId: decoded.args.policyId,
    paidOut: decoded.args.paidOut,
    transactionHash: log.transactionHash as `0x${string}`,
  };
}

export async function fetchSettledLogsFromExplorer(
  apiBase: string,
  contractAddress: string,
): Promise<SettledLog[]> {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: contractAddress,
    topic0: SETTLED_EVENT_TOPIC,
    fromBlock: "0",
    toBlock: "latest",
  });

  const res = await fetch(`${apiBase}?${params}`);
  if (!res.ok) {
    throw new Error(`Explorer API returned ${res.status}`);
  }

  const json = (await res.json()) as {
    status?: string;
    message?: string;
    result?: ExplorerLog[] | string;
  };

  if (json.status !== "1" || !Array.isArray(json.result)) {
    const detail =
      typeof json.result === "string"
        ? json.result
        : (json.message ?? "unknown explorer error");
    throw new Error(`Explorer logs query failed: ${detail}`);
  }

  return json.result.map(parseSettledExplorerLog);
}
