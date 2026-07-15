import { type Address, zeroAddress } from "viem";

function addressFromEnv(value: string | undefined, fallback: Address): Address {
  if (!value || value.length < 42) return fallback;
  return value as Address;
}

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "114");

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  "https://coston2-api.flare.network/ext/C/rpc";

export const WEATHER_INSURANCE_ADDRESS = addressFromEnv(
  process.env.NEXT_PUBLIC_WEATHER_INSURANCE,
  "0x32e5C99DEa13a0D3a40969f85389f71c7787BB18",
);

export const PAY_TOKEN_ADDRESS = addressFromEnv(
  process.env.NEXT_PUBLIC_PAY_TOKEN,
  "0x53192e788991AD96bC180249B15AefB94E597dD1",
);

export const INSTRUCTION_FEE_WEI = BigInt(
  process.env.NEXT_PUBLIC_INSTRUCTION_FEE_WEI ?? "1000000000000",
);

// Base URL of the x402 payment gateway (Next.js /x402/weather/* routes), e.g.
// "http://localhost:3000".
export const X402_GATEWAY_URL =
  process.env.NEXT_PUBLIC_X402_GATEWAY_URL ?? "http://localhost:3000";

export const EXPLORER_TX_URL = "https://coston2-explorer.flare.network/tx/";
export const EXPLORER_ADDRESS_URL =
  "https://coston2-explorer.flare.network/address/";
export const EXPLORER_API_URL =
  "https://coston2-explorer.flare.network/api";

export const OPENWEATHERMAP_URL = "https://openweathermap.org";

export function isConfigured(): boolean {
  return (
    WEATHER_INSURANCE_ADDRESS !== zeroAddress &&
    PAY_TOKEN_ADDRESS !== zeroAddress
  );
}
