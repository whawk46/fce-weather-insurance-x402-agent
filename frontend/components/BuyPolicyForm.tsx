"use client";

import { useCallback, useState } from "react";
import { parseEther } from "viem";
import { useAccount, usePublicClient, useReadContract } from "wagmi";

import { useEnsureExtensionReady } from "./ContractSetup";
import { FlareButton } from "./FlareButton";
import { PayTokenSymbol, TokenAmount } from "./PayTokenSymbol";
import { erc20Abi } from "@/lib/abi/erc20";
import { weatherInsuranceAbi } from "@/lib/contracts";
import {
  OPENWEATHERMAP_URL,
  PAY_TOKEN_ADDRESS,
  WEATHER_INSURANCE_ADDRESS,
} from "@/lib/config";
import {
  explorerTx,
  formatMmE2,
  parseMmToMmE2,
  shortenHash,
  todayIsoDateLocal,
} from "@/lib/format";
import { useTx } from "@/lib/hooks/useTx";
import {
  formatLiquidityError,
  liquidityCoversPayout,
} from "@/lib/pool";
import { geocodeCity } from "@/lib/geocode";
import { useDeviceLocation } from "@/lib/hooks/useDeviceLocation";
import { requestAndRelayPrivateBuy } from "@/lib/tee/private-buy";

type Mode = "public" | "private";

export function BuyPolicyForm({ onSuccess }: { onSuccess?: () => void }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { execute, isPending, error, lastHash } = useTx();
  const { ensureReady } = useEnsureExtensionReady();
  const { city, setCity, coords, loading: locationLoading, error: locationError, refresh } =
    useDeviceLocation();
  const [mode, setMode] = useState<Mode>("private");
  const [date, setDate] = useState(todayIsoDateLocal);
  const [thresholdMm, setThresholdMm] = useState("1.00");
  const [payoutTokens, setPayoutTokens] = useState("10");
  const [premiumTokens, setPremiumTokens] = useState("1");
  const [step, setStep] = useState<string | null>(null);

  const premium = parseEther(premiumTokens || "0");
  const payout = parseEther(payoutTokens || "0");
  const threshold = parseMmToMmE2(thresholdMm);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: PAY_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address
      ? [address, WEATHER_INSURANCE_ADDRESS]
      : undefined,
    query: { enabled: !!address },
  });

  const { data: availableLiquidityRaw } = useReadContract({
    address: WEATHER_INSURANCE_ADDRESS,
    abi: weatherInsuranceAbi,
    functionName: "availableLiquidity",
    query: { refetchInterval: 10_000 },
  });

  const { data: payTokenSymbol } = useReadContract({
    address: PAY_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "symbol",
  });

  const symbol =
    typeof payTokenSymbol === "string" && payTokenSymbol.length > 0
      ? payTokenSymbol
      : "WPT";

  const availableLiquidity =
    typeof availableLiquidityRaw === "bigint"
      ? availableLiquidityRaw
      : undefined;

  const poolInsufficient =
    availableLiquidity !== undefined &&
    !liquidityCoversPayout(availableLiquidity, payout, premium);

  const locationMissing = !coords && city.trim().length === 0;

  const needsApproval =
    allowance !== undefined && allowance < premium + payout;

  const handleBuy = useCallback(async () => {
    if (!address) return;

    setStep("Checking contract setup…");
    await ensureReady();

    if (
      availableLiquidity !== undefined &&
      !liquidityCoversPayout(availableLiquidity, payout, premium)
    ) {
      throw new Error(
        formatLiquidityError(availableLiquidity, payout, premium),
      );
    }

    setStep(coords ? "Using your location…" : "Resolving location…");
    const resolved = coords ?? (await geocodeCity(city));
    const { lat, lon } = resolved;

    if (needsApproval) {
      setStep("Approving pay token…");
      await execute({
        address: PAY_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [WEATHER_INSURANCE_ADDRESS, premium + payout],
      });
      await refetchAllowance();
    }

    if (mode === "public") {
      setStep("Buying policy (public)…");
      await execute({
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "buyPolicy",
        args: [date, threshold, payout, premium, lat, lon],
      });
      setStep("Policy purchased");
      onSuccess?.();
      return;
    }

    await requestAndRelayPrivateBuy(
      {
        holder: address,
        date,
        rainThresholdMmE2: threshold,
        payout,
        premium,
        lat,
        lon,
      },
      execute,
      setStep,
      publicClient,
    );

    setStep("Private policy active");
    onSuccess?.();
  }, [
    address,
    date,
    execute,
    mode,
    onSuccess,
    payout,
    premium,
    threshold,
    city,
    coords,
    availableLiquidity,
    publicClient,
    ensureReady,
    needsApproval,
    refetchAllowance,
  ]);

  const buyLabel =
    mode === "private" ? "Buy private policy" : "Buy public policy";
  const buttonLabel = needsApproval ? `Approve & ${buyLabel.toLowerCase()}` : buyLabel;

  if (!isConnected) {
    return (
      <p className="text-sm text-flare-muted">Connect your wallet to buy a policy.</p>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-flare-border bg-white px-3 py-2.5 text-base text-flare-ink";

  return (
    <section className="rounded-2xl border border-flare-border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-semibold text-flare-ink">Buy policy</h2>
        <div
          className="inline-flex rounded-lg border border-flare-border bg-flare-surface p-0.5 text-base"
          role="radiogroup"
          aria-label="Policy visibility"
        >
          {(["private", "public"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`cursor-pointer rounded-md px-3 py-1.5 font-medium transition-colors ${
                mode === m
                  ? "bg-white text-flare-ink shadow-sm"
                  : "text-flare-muted hover:text-flare-ink"
              }`}
            >
              {m === "private" ? "Private" : "Public"}
            </button>
          ))}
        </div>
      </div>

      {mode === "private" && (
        <details className="mt-3 rounded-lg border border-flare-border bg-flare-surface px-3 py-2.5 text-sm leading-relaxed text-flare-muted">
          <summary className="cursor-pointer font-medium text-flare-ink">
            Private mode (ECIES + TEE)
          </summary>
          <p className="mt-2">
            <strong className="font-medium text-flare-ink">ECIES</strong> encrypts
            your policy terms under the TEE public key. Only{" "}
            <a
              href="https://dev.flare.network/fcc/overview"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-flare-primary hover:underline"
            >
              Flare Confidential Compute
            </a>{" "}
            can decrypt them; the chain stores ciphertext only. You relay the
            signed result with{" "}
            <code className="font-mono text-xs">relayPrivateBuy</code>.
          </p>
        </details>
      )}

      <div className="mt-5 space-y-5">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-flare-subtle">
            Coverage
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block text-base">
              <span className="text-flare-muted">Location (City, CC)</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder={locationLoading ? "Detecting your location…" : "Berlin,DE"}
                  className={`min-w-0 flex-1 ${inputClass}`}
                />
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={locationLoading}
                  className="shrink-0 rounded-lg border border-flare-border bg-flare-surface px-3 py-2 text-sm text-flare-muted transition-colors hover:text-flare-ink disabled:opacity-50"
                  title="Use device location"
                >
                  {locationLoading ? "…" : "Locate"}
                </button>
              </div>
              {locationError && (
                <span className="mt-1 block text-xs text-amber-700">{locationError}</span>
              )}
            </label>
            <label className="block text-base">
              <span className="text-flare-muted">Coverage date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-flare-subtle">
            Policy terms
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="block text-base">
              <span className="text-flare-muted">Minimum rainfall (mm)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="1.00"
                value={thresholdMm}
                onChange={(e) => setThresholdMm(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
              <span className="mt-1 block text-xs text-flare-subtle">
                Payout if daily precipitation reaches at least this amount.
              </span>
            </label>
            <label className="block text-base">
              <span className="text-flare-muted">
                Payout (<PayTokenSymbol symbol={symbol} className="text-inherit hover:underline" />)
              </span>
              <input
                type="number"
                min={0}
                step="any"
                value={payoutTokens}
                onChange={(e) => setPayoutTokens(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="block text-base">
              <span className="text-flare-muted">
                Premium (<PayTokenSymbol symbol={symbol} className="text-inherit hover:underline" />)
              </span>
              <input
                type="number"
                min={0}
                step="any"
                value={premiumTokens}
                onChange={(e) => setPremiumTokens(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
          </div>
        </div>

        <dl className="grid gap-x-4 gap-y-3 rounded-lg border border-flare-border bg-flare-surface px-4 py-4 text-sm leading-relaxed text-flare-muted sm:grid-cols-2">
          <div>
            <dt className="font-medium text-flare-ink">Minimum rainfall</dt>
            <dd className="mt-0.5">
              You receive a payout when measured daily precipitation is at least{" "}
              {threshold > 0n ? (
                <span className="font-medium">{formatMmE2(threshold)}</span>
              ) : (
                "your threshold"
              )}
              . The TEE compares{" "}
              <a
                href={OPENWEATHERMAP_URL}
                target="_blank"
                rel="noreferrer"
                className="text-flare-primary hover:underline"
              >
                OpenWeatherMap
              </a>{" "}
              data at settlement.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-flare-ink">Coverage date</dt>
            <dd className="mt-0.5">
              Day rainfall is measured for your location. Settlement opens the
              day after at midnight UTC.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-flare-ink">Payout</dt>
            <dd className="mt-0.5">
              <PayTokenSymbol symbol={symbol} /> paid to you if rainfall meets the
              threshold. The pool
              must cover this amount (your premium counts toward liquidity).
            </dd>
          </div>
          <div>
            <dt className="font-medium text-flare-ink">Premium</dt>
            <dd className="mt-0.5">
              <PayTokenSymbol symbol={symbol} /> you pay at purchase. Not refunded if
              rainfall stays below
              the threshold.
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-5 border-t border-flare-border pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap gap-2 text-sm">
            <span className="rounded-full border border-flare-border bg-flare-surface px-3 py-1.5 text-flare-muted">
              ≥ {threshold > 0n ? formatMmE2(threshold) : "—"} rain
            </span>
            <span className="rounded-full border border-flare-border bg-flare-surface px-3 py-1.5 text-flare-muted">
              {payoutTokens || "0"} <PayTokenSymbol symbol={symbol} className="text-inherit hover:underline" /> payout
            </span>
            <span className="rounded-full border border-flare-border bg-flare-surface px-3 py-1.5 text-flare-muted">
              {premiumTokens || "0"} <PayTokenSymbol symbol={symbol} className="text-inherit hover:underline" /> premium
            </span>
          </div>
          <FlareButton
            loading={isPending}
            disabled={poolInsufficient || locationMissing || locationLoading}
            onClick={handleBuy}
            className="shrink-0"
          >
            {buttonLabel}
          </FlareButton>
        </div>
      </div>

      {poolInsufficient && (
        <p className="mt-3 text-base text-amber-800">
          Pool too small for a {payoutTokens}{" "}
          <PayTokenSymbol symbol={symbol} /> payout. Fund the pool above (need ≥
          <TokenAmount amount={payout} symbol={symbol} /> available after premium) —
          current available:{" "}
          <TokenAmount amount={availableLiquidity} symbol={symbol} />.
        </p>
      )}
      {step && <p className="mt-3 text-base text-flare-muted">{step}</p>}
      {error && <p className="mt-2 text-base text-red-600">{error}</p>}
      {lastHash && (
        <p className="mt-2 font-mono text-base">
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
