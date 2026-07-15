import {
  type Address,
  encodeAbiParameters,
  hexToBytes,
  parseAbiParameters,
} from "viem";

import type { TeePublicKey } from "./types";

/** Matches Go PrivateBuyParamsArg: ABI tuple struct, not flat fields. */
const privateBuyParams = parseAbiParameters(
  "(address holder, address contractAddr, string date, uint256 rainThresholdMmE2, uint256 payout, uint256 premium, string lat, string lon)",
);

/** Build 65-byte uncompressed secp256k1 key from TEE /info machineData.publicKey. */
export function teePublicKeyToBuffer(key: TeePublicKey): Buffer {
  const x = hexToBytes(key.x);
  const y = hexToBytes(key.y);
  if (x.length !== 32 || y.length !== 32) {
    throw new Error(`unexpected TEE coordinate length: x=${x.length} y=${y.length}`);
  }
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(x), Buffer.from(y)]);
}

export function encodePrivateBuyParams(
  holder: Address,
  contractAddr: Address,
  date: string,
  rainThresholdMmE2: bigint,
  payout: bigint,
  premium: bigint,
  lat: string,
  lon: string,
): Uint8Array {
  const encoded = encodeAbiParameters(privateBuyParams, [
    {
      holder,
      contractAddr,
      date,
      rainThresholdMmE2,
      payout,
      premium,
      lat,
      lon,
    },
  ]);
  return hexToBytes(encoded);
}

export async function encryptForTee(
  publicKey: TeePublicKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const { encrypt } = await import("ecies-geth");
  const pub = teePublicKeyToBuffer(publicKey);
  const ciphertext = await encrypt(pub, Buffer.from(plaintext));
  return Uint8Array.from(ciphertext);
}

export async function buildPrivateBuyCiphertext(
  machinePublicKey: TeePublicKey,
  holder: Address,
  contractAddr: Address,
  date: string,
  rainThresholdMmE2: bigint,
  payout: bigint,
  premium: bigint,
  lat: string,
  lon: string,
): Promise<`0x${string}`> {
  const plaintext = encodePrivateBuyParams(
    holder,
    contractAddr,
    date,
    rainThresholdMmE2,
    payout,
    premium,
    lat,
    lon,
  );
  const encrypted = await encryptForTee(machinePublicKey, plaintext);
  return `0x${Buffer.from(encrypted).toString("hex")}` as `0x${string}`;
}
