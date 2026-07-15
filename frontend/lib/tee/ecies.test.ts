import { describe, expect, it } from "vitest";
import { encodeAbiParameters, hexToBytes, parseAbiParameters } from "viem";

import {
  encodePrivateBuyParams,
  teePublicKeyToBuffer,
} from "./ecies";
import type { TeePublicKey } from "./types";

describe("teePublicKeyToBuffer", () => {
  it("builds 65-byte uncompressed key from x/y coordinates", () => {
    const key: TeePublicKey = {
      x: `0x${"11".repeat(32)}`,
      y: `0x${"22".repeat(32)}`,
    };
    const buf = teePublicKeyToBuffer(key);
    expect(buf.length).toBe(65);
    expect(buf[0]).toBe(0x04);
  });
});

describe("encodePrivateBuyParams", () => {
  it("ABI-encodes private buy fields including location", () => {
    const encoded = encodePrivateBuyParams(
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "2026-05-26",
      1n,
      10n ** 18n,
      10n ** 18n,
      "52.52",
      "13.405",
    );
    expect(encoded.length).toBeGreaterThan(0);

    const params = parseAbiParameters(
      "(address holder, address contractAddr, string date, uint256 rainThresholdMmE2, uint256 payout, uint256 premium, string lat, string lon)",
    );
    const manual = encodeAbiParameters(params, [
      [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
        "2026-05-26",
        1n,
        10n ** 18n,
        10n ** 18n,
        "52.52",
        "13.405",
      ],
    ]);
    expect(Buffer.from(encoded).equals(Buffer.from(hexToBytes(manual)))).toBe(
      true,
    );
  });
});
