"use client";

import { useCallback, useState } from "react";
import { parseEther } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { FlareButton } from "./FlareButton";
import { PayTokenSymbol, TokenAmount } from "./PayTokenSymbol";
import { weatherInsuranceAbi } from "@/lib/contracts";
import {
  PAY_TOKEN_ADDRESS,
  WEATHER_INSURANCE_ADDRESS,
} from "@/lib/config";
import { erc20Abi } from "@/lib/abi/erc20";
import {
  explorerAddress,
  explorerTx,
  formatTokenAmount,
  shortenAddress,
  shortenHash,
} from "@/lib/format";
import { liquidityCoversPayout } from "@/lib/pool";
import { useTx } from "@/lib/hooks/useTx";

export function PoolStats() {
  const { address, isConnected } = useAccount();
  const { execute, isPending, error, lastHash } = useTx();
  const [fundTokens, setFundTokens] = useState("10");
  const [isFunding, setIsFunding] = useState(false);

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      {
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "availableLiquidity",
      },
      {
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "reserved",
      },
      {
        address: PAY_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [WEATHER_INSURANCE_ADDRESS],
      },
      {
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "teeAddress",
      },
      {
        address: PAY_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "symbol",
      },
      {
        address: PAY_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "decimals",
      },
      {
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "feeToken",
      },
    ],
    query: { refetchInterval: 10_000 },
  });

  const toBigint = (v: unknown): bigint | undefined =>
    typeof v === "bigint" ? v : undefined;

  const available = toBigint(data?.[0]?.result);
  const reserved = toBigint(data?.[1]?.result);
  const totalBalance = toBigint(data?.[2]?.result);
  const tee = data?.[3]?.result as `0x${string}` | undefined;
  const symbol = (data?.[4]?.result as string | undefined) ?? "WPT";
  const decimals = (data?.[5]?.result as number | undefined) ?? 18;
  const feeToken = data?.[6]?.result as `0x${string}` | undefined;
  const feeTokenSet =
    feeToken && feeToken !== "0x0000000000000000000000000000000000000000";

  const { data: feeTokenData } = useReadContracts({
    contracts: [
      {
        address: feeToken,
        abi: erc20Abi,
        functionName: "symbol",
      },
      {
        address: feeToken,
        abi: erc20Abi,
        functionName: "decimals",
      },
      {
        address: feeToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
      },
    ],
    query: { enabled: !!feeTokenSet, refetchInterval: 10_000 },
  });

  const feeTokenSymbol = (feeTokenData?.[0]?.result as string | undefined) ?? "FEE";
  const feeTokenDecimals = (feeTokenData?.[1]?.result as number | undefined) ?? 18;
  const feeTokenBalance = toBigint(feeTokenData?.[2]?.result);

  const fundAmount = parseEther(fundTokens || "0");

  const { data: fundAllowance, refetch: refetchFundAllowance } = useReadContract({
    address: PAY_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, WEATHER_INSURANCE_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const needsFundApproval =
    fundAllowance !== undefined && fundAllowance < fundAmount;

  const handleFundPool = useCallback(async () => {
    if (!address || fundAmount <= 0n) return;
    setIsFunding(true);
    try {
      if (needsFundApproval) {
        await execute({
          address: PAY_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [WEATHER_INSURANCE_ADDRESS, fundAmount],
        });
        await refetchFundAllowance();
      }
      await execute({
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "fundPool",
        args: [fundAmount],
      });
      await refetch();
    } finally {
      setIsFunding(false);
    }
  }, [
    address,
    execute,
    fundAmount,
    needsFundApproval,
    refetch,
    refetchFundAllowance,
  ]);

  const demoPayout = parseEther("10");
  const demoPremium = parseEther("1");
  const demoBuyOk =
    available !== undefined &&
    liquidityCoversPayout(available, demoPayout, demoPremium);

  return (
    <section className="rounded-xl border border-flare-border bg-flare-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-flare-ink">Payout pool</h2>
        <p className="text-xs text-flare-muted">
          {available === undefined ? (
            "…"
          ) : demoBuyOk ? (
            <span className="text-green-700">Demo buy OK</span>
          ) : (
            <span className="text-amber-800">
              Fund ≥ <TokenAmount amount={demoPayout} decimals={decimals} symbol={symbol} /> for demo
            </span>
          )}
        </p>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-flare-border bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-flare-subtle">
            Total
          </p>
          <p className="text-lg font-bold leading-tight text-flare-ink">
            {isLoading || totalBalance === undefined
              ? "…"
              : <TokenAmount amount={totalBalance} decimals={decimals} symbol={symbol} />}
          </p>
        </div>
        <div className="rounded-lg border border-flare-border bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-flare-subtle">
            Reserved
          </p>
          <p className="text-sm font-medium leading-tight text-flare-ink">
            {reserved === undefined
              ? "…"
              : <TokenAmount amount={reserved} decimals={decimals} symbol={symbol} />}
          </p>
        </div>
        <div className="rounded-lg border border-flare-border bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-flare-subtle">
            Available
          </p>
          <p className="text-sm font-medium leading-tight text-flare-ink">
            {available === undefined
              ? "…"
              : <TokenAmount amount={available} decimals={decimals} symbol={symbol} />}
          </p>
        </div>
      </div>

      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-flare-subtle">
        <div className="flex items-baseline gap-1">
          <dt>Contract</dt>
          <dd className="font-mono">
            <a
              href={explorerAddress(WEATHER_INSURANCE_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="text-flare-primary hover:underline"
            >
              {shortenAddress(WEATHER_INSURANCE_ADDRESS)}
            </a>
          </dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt>
            <PayTokenSymbol symbol={symbol} className="text-inherit hover:underline" />
          </dt>
          <dd className="font-mono">
            <a
              href={explorerAddress(PAY_TOKEN_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="text-flare-primary hover:underline"
            >
              {shortenAddress(PAY_TOKEN_ADDRESS)}
            </a>
          </dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt>TEE</dt>
          <dd className="font-mono">
            {tee && tee !== "0x0000000000000000000000000000000000000000" ? (
              <a
                href={explorerAddress(tee)}
                target="_blank"
                rel="noreferrer"
                className="text-flare-primary hover:underline"
              >
                {shortenAddress(tee)}
              </a>
            ) : (
              <span className="text-flare-muted">not set</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt>Fee ({feeTokenSet ? feeTokenSymbol : "—"})</dt>
          <dd className="font-mono">
            {feeTokenSet ? (
              <a
                href={explorerAddress(feeToken)}
                target="_blank"
                rel="noreferrer"
                className="text-flare-primary hover:underline"
              >
                {shortenAddress(feeToken)}
              </a>
            ) : (
              <span className="text-flare-muted">not set</span>
            )}
          </dd>
        </div>
      </dl>

      {isConnected && feeTokenSet && (
        <p className="mt-1 text-[11px] text-flare-subtle">
          Your fee token balance:{" "}
          {feeTokenBalance === undefined ? (
            "…"
          ) : (
            <span className="font-mono text-flare-ink">
              {formatTokenAmount(feeTokenBalance, feeTokenDecimals)}{" "}
              <a
                href={explorerAddress(feeToken)}
                target="_blank"
                rel="noreferrer"
                className="text-flare-primary hover:underline"
              >
                {feeTokenSymbol}
              </a>
            </span>
          )}
        </p>
      )}

      {isConnected && (
        <div className="mt-2 rounded-lg border border-flare-border bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-flare-muted">
                Fund (<PayTokenSymbol symbol={symbol} className="text-inherit hover:underline" />)
              </span>
              <input
                type="number"
                min={0}
                step="any"
                value={fundTokens}
                onChange={(e) => setFundTokens(e.target.value)}
                className="w-20 rounded-md border border-flare-border bg-white px-2 py-1 text-sm"
              />
            </label>
            <FlareButton
              variant="secondary"
              loading={isFunding || isPending}
              disabled={fundAmount <= 0n}
              onClick={handleFundPool}
              className="px-3! py-1! text-xs!"
            >
              {needsFundApproval ? "Approve & fund" : "Fund pool"}
            </FlareButton>
          </div>
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
          {lastHash && (
            <p className="mt-1 font-mono text-sm">
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
        </div>
      )}
    </section>
  );
}
