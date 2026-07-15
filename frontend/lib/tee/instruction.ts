import {
  type Hash,
  type Hex,
  type Log,
  type TransactionReceipt,
  decodeEventLog,
  parseAbiItem,
  toEventSelector,
} from "viem";

import { weatherInsuranceEventsAbi } from "@/lib/abi/events";
import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";

/** Topic0 for TeeInstructionsSent (Verification / ExtensionRegistry on Coston2). */
export const teeInstructionsSentTopic = toEventSelector(
  parseAbiItem(
    "event TeeInstructionsSent(uint256 indexed extensionId, bytes32 indexed instructionId, uint32 indexed rewardEpochId, (address teeId, address teeProxyId, string url)[] teeMachines, bytes32 opType, bytes32 opCommand, bytes message, address[] cosigners, uint64 cosignersThreshold, address claimBackAddress, uint256 fee)",
  ),
);

export type TeeInstructionsSentHead = {
  extensionId: bigint;
  instructionId: Hash;
  rewardEpochId: number;
};

/**
 * Parse instructionId from TeeInstructionsSent indexed topics only.
 * @see https://coston2-explorer.flare.network/tx/0xe8ce49f2b9ccb153e90d8c5010e087056d2908d5d05f652d8d3604f04c0e4bba?tab=logs
 * topic[1]=extensionId, topic[2]=instructionId, topic[3]=rewardEpochId
 */
export function parseTeeInstructionsSentFromLog(
  log: Pick<Log, "topics">,
): TeeInstructionsSentHead | null {
  const { topics } = log;
  if (topics.length < 4 || topics[0] !== teeInstructionsSentTopic) {
    return null;
  }
  const instructionId = topics[2];
  if (!instructionId || instructionId.length !== 66) {
    return null;
  }
  return {
    extensionId: BigInt(topics[1] ?? 0),
    instructionId,
    rewardEpochId: Number(BigInt(topics[3] ?? 0)),
  };
}

/** First TeeInstructionsSent log in a getWeather / sendInstructions receipt. */
export function parseTeeInstructionsSentFromReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
): TeeInstructionsSentHead | null {
  for (const log of receipt.logs ?? []) {
    const parsed = parseTeeInstructionsSentFromLog(log);
    if (parsed) return parsed;
  }
  return null;
}

export function parseInstructionIdFromReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
): Hash | null {
  const sent = parseTeeInstructionsSentFromReceipt(receipt);
  if (sent) return sent.instructionId;

  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== WEATHER_INSURANCE_ADDRESS.toLowerCase()) {
      continue;
    }

    try {
      const privateBuy = decodeEventLog({
        abi: weatherInsuranceEventsAbi,
        data: log.data,
        topics: log.topics,
        eventName: "PrivateBuyRequested",
      });
      if (privateBuy.args?.instructionId) {
        return privateBuy.args.instructionId;
      }
    } catch {
      /* not this event */
    }
    try {
      const settlement = decodeEventLog({
        abi: weatherInsuranceEventsAbi,
        data: log.data,
        topics: log.topics,
        eventName: "SettlementRequested",
      });
      if (settlement.args?.instructionId) {
        return settlement.args.instructionId;
      }
    } catch {
      /* not this event */
    }
  }
  return null;
}

export type WeatherReport = {
  city: string;
  country: string;
  description: string;
  tempC: number;
  feelsLikeC: number;
  humidityPct: number;
  pressureHpa: number;
  windMS: number;
  observedAt: number;
};

export function decodeWeatherReport(data: Hex): WeatherReport | null {
  try {
    const hex = data.startsWith("0x") ? data.slice(2) : data;
    const json = Buffer.from(hex, "hex").toString("utf8");
    return JSON.parse(json) as WeatherReport;
  } catch {
    return null;
  }
}
