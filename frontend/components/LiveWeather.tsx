"use client";

import { useCallback, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";

import { FlareButton } from "./FlareButton";
import { WeatherReportCard } from "./WeatherReportCard";
import { erc20Abi } from "@/lib/abi/erc20";
import { weatherInsuranceAbi } from "@/lib/contracts";
import { OPENWEATHERMAP_URL, WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import { explorerTx, formatTokenAmount, shortenHash } from "@/lib/format";
import { useDeviceLocation } from "@/lib/hooks/useDeviceLocation";
import { useTx } from "@/lib/hooks/useTx";
import type { WeatherReport } from "@/lib/tee/instruction";
import { payAndFetch } from "@/lib/tee/x402";

type FetchGatewayResponse = {
  instructionId: string;
  requestTx: `0x${string}`;
  report: WeatherReport;
};

export function LiveWeather() {
  const { city, setCity, loading: locationLoading, error: locationError, refresh } =
    useDeviceLocation();
  const [report, setReport] = useState<WeatherReport | null>(null);
  const [requestTx, setRequestTx] = useState<`0x${string}` | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute } = useTx();
  const { address } = useAccount();

  const { data } = useReadContracts({
    contracts: [
      { address: WEATHER_INSURANCE_ADDRESS, abi: weatherInsuranceAbi, functionName: "feeToken" },
      { address: WEATHER_INSURANCE_ADDRESS, abi: weatherInsuranceAbi, functionName: "fetchFee" },
    ],
    query: { refetchInterval: 10_000 },
  });
  const feeToken = data?.[0]?.result as `0x${string}` | undefined;
  const fetchFee = data?.[1]?.result as bigint | undefined;
  const feeTokenSet =
    feeToken && feeToken !== "0x0000000000000000000000000000000000000000";

  const { data: feeTokenMeta } = useReadContracts({
    contracts: [
      { address: feeToken, abi: erc20Abi, functionName: "symbol" },
      { address: feeToken, abi: erc20Abi, functionName: "decimals" },
    ],
    query: { enabled: !!feeTokenSet },
  });
  const feeTokenSymbol = (feeTokenMeta?.[0]?.result as string | undefined) ?? "FEE";
  const feeTokenDecimals = (feeTokenMeta?.[1]?.result as number | undefined) ?? 18;

  const handleFetch = useCallback(async () => {
    if (!address) {
      setError("Connect wallet first");
      return;
    }
    setReport(null);
    setRequestTx(null);
    setError(null);
    setBusy(true);
    try {
      const { report: decoded, requestTx: tx } = await payAndFetch<FetchGatewayResponse>(
        "/x402/weather/fetch",
        { city, payer: address },
        execute,
        setStep,
      );
      setReport(decoded);
      setRequestTx(tx);
      setStep("Done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch weather failed");
    } finally {
      setBusy(false);
    }
  }, [city, execute, address]);

  return (
    <section className="rounded-2xl border border-flare-border bg-flare-surface-strong p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-flare-ink">Live weather (FETCH)</h2>
      <p className="mt-1 text-sm text-flare-muted">
        x402: the gateway asks for a fee approval (402 Payment Required) if one
        is configured, then relays <code className="font-mono text-xs">getWeather</code>{" "}
        to the TEE, polls the proxy for the signed result, and decodes{" "}
        <a
          href={OPENWEATHERMAP_URL}
          target="_blank"
          rel="noreferrer"
          className="text-flare-primary hover:underline"
        >
          OpenWeatherMap
        </a>{" "}
        JSON.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder={locationLoading ? "Detecting your location…" : "Berlin,DE"}
          className="min-w-[200px] flex-1 rounded-lg border border-flare-border-mid bg-white px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={locationLoading}
          className="rounded-lg border border-flare-border-mid bg-white px-3 py-2 text-sm text-flare-muted transition-colors hover:text-flare-ink disabled:opacity-50"
          title="Use device location"
        >
          {locationLoading ? "…" : "Locate"}
        </button>
        <FlareButton loading={busy} onClick={handleFetch} disabled={!city.trim() || locationLoading}>
          Fetch weather
        </FlareButton>
      </div>
      {locationError && (
        <p className="mt-2 text-xs text-amber-700">{locationError}</p>
      )}
      <p className="mt-2 text-xs text-flare-subtle">
        {!feeTokenSet || fetchFee === undefined ? (
          "No on-chain fee configured"
        ) : fetchFee === 0n ? (
          "Fee: free (fetchFee disabled)"
        ) : (
          <>Fee: {formatTokenAmount(fetchFee, feeTokenDecimals)} {feeTokenSymbol} per fetch</>
        )}
      </p>
      {step && <p className="mt-3 text-sm text-flare-muted">{step}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {requestTx && (
        <p className="mt-2 font-mono text-sm">
          <a
            href={explorerTx(requestTx)}
            target="_blank"
            rel="noreferrer"
            className="text-flare-primary hover:underline"
          >
            {shortenHash(requestTx)}
          </a>
        </p>
      )}
      {report && <WeatherReportCard report={report} />}
    </section>
  );
}
