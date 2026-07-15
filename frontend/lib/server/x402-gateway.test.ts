import { encodeAbiParameters, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  buildPaymentRequirements,
  decodeSettlementResultData,
  FETCH_RESOURCE,
  parseFetchRequest,
  parseSettleRequest,
} from "./x402-gateway";

const PAYER = "0x0000000000000000000000000000000000000001" as Address;
const FEE_TOKEN = "0x0b6A3645c240605887a5532109323A3E12273dc7" as Address;
const SPENDER = "0xF501F9c8394b868613b5Db3D284C6368F687c1B8" as Address;

describe("parseFetchRequest", () => {
  it("rejects missing city", () => {
    const result = parseFetchRequest({ payer: PAYER });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("city is required");
    }
  });

  it("rejects missing payer", () => {
    const result = parseFetchRequest({ city: "Berlin,DE" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("payer is required");
    }
  });

  it("accepts valid body", () => {
    const result = parseFetchRequest({ city: "Berlin,DE", payer: PAYER });
    expect(result).toEqual({ ok: true, city: "Berlin,DE", payer: PAYER });
  });
});

describe("parseSettleRequest", () => {
  it("rejects non-integer policyId", () => {
    const result = parseSettleRequest({
      policyId: "not-a-number",
      payer: PAYER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "policyId is required and must be a base-10 integer string",
      );
    }
  });

  it("rejects missing payer", () => {
    const result = parseSettleRequest({ policyId: "3" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("payer is required");
    }
  });

  it("accepts numeric policyId as string", () => {
    const result = parseSettleRequest({ policyId: "3", payer: PAYER });
    expect(result).toEqual({ ok: true, policyId: 3n, payer: PAYER });
  });
});

describe("buildPaymentRequirements", () => {
  it("matches the 402 body contract the frontend relies on", () => {
    const body = buildPaymentRequirements(
      FETCH_RESOURCE,
      FEE_TOKEN,
      SPENDER,
      10_000n,
      0n,
    );

    expect(body).toEqual({
      x402Version: 1,
      resource: FETCH_RESOURCE,
      chainId: 114,
      asset: FEE_TOKEN,
      spender: SPENDER,
      amountBase: "10000",
      currentAllowanceBase: "0",
    });

    for (const key of [
      "x402Version",
      "resource",
      "chainId",
      "asset",
      "spender",
      "amountBase",
      "currentAllowanceBase",
    ]) {
      expect(body).toHaveProperty(key);
    }
  });
});

describe("decodeSettlementResultData", () => {
  it("round-trips settlement ABI tuple", () => {
    const contractAddr = "0x1234567890123456789012345678901234567890" as Address;
    const encoded = encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "string" },
        { type: "uint256" },
        { type: "bool" },
      ],
      [contractAddr, 2n, 150n, "2026-07-20", 200n, true],
    ) as Hex;

    const decoded = decodeSettlementResultData(encoded);
    expect(decoded).toEqual({
      precipitationMmE2: 150n,
      date: "2026-07-20",
      revealedThresholdMmE2: 200n,
      triggered: true,
    });
  });
});
