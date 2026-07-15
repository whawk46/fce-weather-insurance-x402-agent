"use client";

import { useCallback } from "react";

import { FlareButton } from "./FlareButton";
import { weatherInsuranceAbi } from "@/lib/contracts";
import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import { explorerTx, shortenHash } from "@/lib/format";
import {
  useExtensionReady,
  type ExtensionReadyStatus,
} from "@/lib/hooks/useExtensionReady";
import { useTx } from "@/lib/hooks/useTx";

function statusMessage(status: ExtensionReadyStatus): string | null {
  switch (status) {
    case "ready":
    case "checking":
    case "disconnected":
      return null;
    case "needs_set":
      return "This contract has not been linked to its FCC extension yet. Run one on-chain setup transaction before buying or settling policies.";
    case "not_registered":
      return "Extension ID not found in the registry. Run bash ./scripts/pre-build.sh to deploy and register the extension.";
    case "unknown":
      return "Could not verify extension setup. Try setting the extension ID below.";
    default:
      return null;
  }
}

export function ContractSetup() {
  const { status, refetch } = useExtensionReady();
  const { execute, isPending, error, lastHash } = useTx();

  const handleSetExtensionId = useCallback(async () => {
    await execute({
      address: WEATHER_INSURANCE_ADDRESS,
      abi: weatherInsuranceAbi,
      functionName: "setExtensionId",
    });
    await refetch();
  }, [execute, refetch]);

  const message = statusMessage(status);
  if (!message) return null;

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
      <h2 className="font-semibold">Contract setup required</h2>
      <p className="mt-2 text-sm">{message}</p>
      <p className="mt-2 font-mono text-xs text-amber-800">
        Revert you saw: &quot;Extension ID is not set.&quot; — same fix as{" "}
        <code className="rounded bg-amber-100 px-1">test.sh</code> step 1.
      </p>
      {status === "needs_set" || status === "unknown" ? (
        <div className="mt-4">
          <FlareButton loading={isPending} onClick={handleSetExtensionId}>
            Set extension ID
          </FlareButton>
        </div>
      ) : null}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {lastHash && (
        <p className="mt-2 font-mono text-sm">
          <a
            href={explorerTx(lastHash)}
            target="_blank"
            rel="noreferrer"
            className="text-flare-primary hover:underline"
          >
            {shortenHash(lastHash)}
          </a>
        </p>
      )}
    </section>
  );
}

/** Call before any instruction that uses _getExtensionId(). */
export function useEnsureExtensionReady() {
  const { status, refetch } = useExtensionReady();
  const { execute } = useTx();

  const ensureReady = useCallback(async () => {
    if (status === "ready") return;
    if (status === "not_registered") {
      throw new Error(
        "Extension not registered on-chain. Run ./scripts/pre-build.sh first.",
      );
    }
    if (status === "needs_set" || status === "unknown") {
      await execute({
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "setExtensionId",
      });
      await refetch();
      return;
    }
    if (status === "checking") {
      throw new Error("Still checking contract setup — try again in a moment.");
    }
    throw new Error("Connect wallet and set extension ID first.");
  }, [status, execute, refetch]);

  return { status, ensureReady };
}
