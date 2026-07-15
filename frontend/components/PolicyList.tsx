"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  Calendar,
  ChevronRight,
  Droplets,
  ExternalLink,
  Lock,
  MapPin,
} from "lucide-react";
import type { Hash } from "viem";
import { useAccount, useBlock, useReadContract, useReadContracts } from "wagmi";

import { FlareButton } from "./FlareButton";
import { TokenAmount } from "./PayTokenSymbol";
import { PolicyLocation } from "./PolicyLocation";
import { weatherInsuranceAbi } from "@/lib/contracts";
import { WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import {
  explorerAddress,
  explorerTx,
  formatMmE2,
  shortenAddress,
  shortenHash,
} from "@/lib/format";
import {
  policyTxHashesQueryKey,
  usePolicyTxHashes,
  type PolicyTxHashMaps,
} from "@/lib/hooks/usePolicyTxHashes";
import { useTx } from "@/lib/hooks/useTx";
import { normalizePolicyReadResult } from "@/lib/policy";
import {
  canSettleNow,
  formatSettlementOpensLabel,
  formatSettlementUnlock,
} from "@/lib/settlement-time";
import { payAndFetch } from "@/lib/tee/x402";

type PolicyStatus = "active" | "paid" | "no-payout";

function policyStatus(p: {
  settled: boolean;
  paidOut: boolean;
}): PolicyStatus {
  if (!p.settled) return "active";
  if (p.paidOut) return "paid";
  return "no-payout";
}

const STATUS_STYLES: Record<
  PolicyStatus,
  { badge: string; accent: string; label: string }
> = {
  active: {
    badge: "bg-sky-50 text-sky-800 ring-sky-200",
    accent: "border-l-sky-400",
    label: "Active",
  },
  paid: {
    badge: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    accent: "border-l-emerald-500",
    label: "Paid out",
  },
  "no-payout": {
    badge: "bg-slate-100 text-slate-700 ring-slate-200",
    accent: "border-l-slate-300",
    label: "No payout",
  },
};

function PolicyTypeBadge({ isPrivate }: { isPrivate: boolean }) {
  if (isPrivate) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-violet-200 ring-inset"
        title="Rain threshold is stored in the TEE, not on-chain"
      >
        <Lock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        Private
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 ring-inset">
      Public
    </span>
  );
}

function HiddenTerms() {
  return (
    <span
      className="inline-flex items-center gap-1 text-flare-subtle"
      title="Rain threshold is held in the TEE (not visible on-chain)"
    >
      <Lock className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
      Hidden
    </span>
  );
}

function TxLink({ hash, label }: { hash: Hash; label?: string }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-flare-primary hover:underline"
      title={hash}
    >
      {label ?? shortenHash(hash)}
      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
    </a>
  );
}

function CoverageTerms({
  isPrivate,
  date,
  rainThresholdMmE2,
  buyTxHash,
}: {
  isPrivate: boolean;
  date: string;
  rainThresholdMmE2: bigint;
  buyTxHash?: Hash;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="inline-flex items-center gap-1.5 text-flare-ink">
        <Calendar className="h-3.5 w-3.5 shrink-0 text-flare-subtle" aria-hidden />
        {date}
      </span>
      <span className="inline-flex items-center gap-1.5 text-flare-muted">
        <Droplets className="h-3.5 w-3.5 shrink-0 text-flare-subtle" aria-hidden />
        {isPrivate ? (
          <HiddenTerms />
        ) : (
          <>≥ {formatMmE2(rainThresholdMmE2)}</>
        )}
      </span>
      {isPrivate && buyTxHash && <TxLink hash={buyTxHash} />}
    </div>
  );
}

function SettlementDetails({
  status,
  payout,
  measuredMmE2,
  buyTxHash,
  settlementTxHash,
}: {
  status: PolicyStatus;
  payout: bigint;
  measuredMmE2: bigint;
  buyTxHash?: Hash;
  settlementTxHash?: Hash;
}) {
  const styles = STATUS_STYLES[status];

  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${styles.badge}`}
      >
        {styles.label}
      </span>
      {status === "paid" && payout > 0n && (
        <span className="text-sm font-medium text-emerald-800">
          <TokenAmount
            amount={payout}
            symbolClassName="text-emerald-800 hover:underline"
          />
        </span>
      )}
      {status !== "active" && measuredMmE2 >= 0n && (
        <span className="text-xs text-flare-muted">
          {formatMmE2(measuredMmE2)} measured
        </span>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {buyTxHash && <TxLink hash={buyTxHash} label="Buy" />}
        {settlementTxHash && <TxLink hash={settlementTxHash} label="Settle" />}
      </div>
    </div>
  );
}

function PolicyAction({
  canSettle,
  isOwner,
  settled,
  settlementOpen,
  settlementUnlockAt,
  isPending,
  onSettle,
}: {
  canSettle: boolean;
  isOwner: boolean;
  settled: boolean;
  settlementOpen: boolean;
  settlementUnlockAt: bigint;
  isPending: boolean;
  onSettle: () => void;
}) {
  if (canSettle) {
    return (
      <FlareButton
        variant="secondary"
        loading={isPending}
        onClick={onSettle}
        className="px-3! py-1.5! text-xs!"
      >
        Settle
      </FlareButton>
    );
  }
  if (isOwner && !settled && !settlementOpen) {
    return (
      <span
        className="text-xs text-flare-subtle"
        title={`Settlement opens ${formatSettlementUnlock(settlementUnlockAt)} UTC`}
      >
        {formatSettlementOpensLabel(settlementUnlockAt)}
      </span>
    );
  }
  return <span className="text-xs text-flare-subtle">—</span>;
}

type PolicyRow = {
  index: number;
  p: NonNullable<ReturnType<typeof normalizePolicyReadResult>>;
  isOwner: boolean;
  settlementOpen: boolean;
  canSettle: boolean;
  status: PolicyStatus;
  buyTxHash?: Hash;
  settlementTxHash?: Hash;
};

function PolicyCard({
  row,
  isPending,
  onSettle,
}: {
  row: PolicyRow;
  isPending: boolean;
  onSettle: () => void;
}) {
  const { index, p, isOwner, settlementOpen, canSettle, status, buyTxHash, settlementTxHash } =
    row;
  const styles = STATUS_STYLES[status];

  return (
    <article
      className={`rounded-xl border border-flare-border bg-white p-4 shadow-sm border-l-4 ${styles.accent}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-flare-ink">
            #{index}
          </span>
          <PolicyTypeBadge isPrivate={p.isPrivate} />
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${styles.badge}`}
        >
          {styles.label}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-start gap-1.5 text-sm">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-flare-subtle" aria-hidden />
          {p.lat && p.lon ? (
            <PolicyLocation lat={p.lat} lon={p.lon} />
          ) : (
            <span className="text-flare-subtle">—</span>
          )}
        </div>
        <CoverageTerms
          isPrivate={p.isPrivate}
          date={p.date}
          rainThresholdMmE2={p.rainThresholdMmE2}
          buyTxHash={buyTxHash}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-flare-border/60 pt-3">
        <a
          href={explorerAddress(p.policyholder)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-flare-primary hover:underline"
        >
          {shortenAddress(p.policyholder)}
        </a>
        <PolicyAction
          canSettle={canSettle}
          isOwner={isOwner}
          settled={p.settled}
          settlementOpen={settlementOpen}
          settlementUnlockAt={p.settlementUnlockAt}
          isPending={isPending}
          onSettle={onSettle}
        />
      </div>

      {(status === "paid" || status === "no-payout" || buyTxHash) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {status === "paid" && p.payout > 0n && (
            <span className="font-medium text-emerald-800">
              <TokenAmount
                amount={p.payout}
                symbolClassName="text-emerald-800 hover:underline"
              />
            </span>
          )}
          {status !== "active" && (
            <span className="text-flare-muted">
              {formatMmE2(p.measuredMmE2)} measured
            </span>
          )}
          {buyTxHash && <TxLink hash={buyTxHash} label="Buy" />}
          {settlementTxHash && <TxLink hash={settlementTxHash} label="Settle" />}
        </div>
      )}
    </article>
  );
}

function PolicyTableRow({
  row,
  isPending,
  onSettle,
}: {
  row: PolicyRow;
  isPending: boolean;
  onSettle: () => void;
}) {
  const { index, p, isOwner, settlementOpen, canSettle, status, buyTxHash, settlementTxHash } =
    row;
  const styles = STATUS_STYLES[status];

  return (
    <tr
      className={`group border-b border-flare-border/50 border-l-4 bg-white transition-colors hover:bg-flare-surface/40 ${styles.accent}`}
    >
      <td className="px-4 py-3.5">
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-sm font-semibold text-flare-ink">
            #{index}
          </span>
          <PolicyTypeBadge isPrivate={p.isPrivate} />
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex flex-col gap-1 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-flare-subtle" aria-hidden />
            {p.lat && p.lon ? (
              <PolicyLocation lat={p.lat} lon={p.lon} />
            ) : (
              <span className="text-flare-subtle">—</span>
            )}
          </span>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <CoverageTerms
          isPrivate={p.isPrivate}
          date={p.date}
          rainThresholdMmE2={p.rainThresholdMmE2}
          buyTxHash={buyTxHash}
        />
      </td>
      <td className="px-4 py-3.5">
        <a
          href={explorerAddress(p.policyholder)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-flare-primary hover:underline"
        >
          {shortenAddress(p.policyholder)}
        </a>
      </td>
      <td className="px-4 py-3.5">
        <SettlementDetails
          status={status}
          payout={p.payout}
          measuredMmE2={p.measuredMmE2}
          buyTxHash={buyTxHash}
          settlementTxHash={settlementTxHash}
        />
      </td>
      <td className="px-4 py-3.5 text-right">
        <PolicyAction
          canSettle={canSettle}
          isOwner={isOwner}
          settled={p.settled}
          settlementOpen={settlementOpen}
          settlementUnlockAt={p.settlementUnlockAt}
          isPending={isPending}
          onSettle={onSettle}
        />
      </td>
    </tr>
  );
}

function PolicyLegend() {
  return (
    <details className="group mt-4 rounded-lg border border-flare-border bg-white/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-flare-muted marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        How policies work
      </summary>
      <div className="border-t border-flare-border/60 px-4 py-3 text-sm leading-relaxed text-flare-subtle">
        <p>
          <span className="font-medium text-emerald-800">Public</span> policies store
          coverage date and rain threshold on-chain.
        </p>
        <p className="mt-1.5">
          <span className="font-medium text-violet-800">Private</span> policies store
          the coverage date on-chain but keep the rain threshold in the TEE until
          settlement; after settle, the threshold is written on-chain.
        </p>
        <p className="mt-1.5">
          <span className="font-medium text-emerald-800">Paid out</span> means rainfall
          exceeded threshold.<br />
          <span className="font-medium text-slate-700">No payout</span> means settled
          below threshold. Settlement opens at midnight UTC the day after the coverage
          date. Premiums and payouts use{" "}
          <TokenAmount amount={BigInt(1e18)} /> scale (18 decimals).
        </p>
      </div>
    </details>
  );
}

export function PolicyList() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const { data: block } = useBlock({ watch: true });
  const nowSec = block?.timestamp ?? 0n;
  const { execute, isPending, error } = useTx();
  const [settlingId, setSettlingId] = useState<bigint | null>(null);

  const { data: count, refetch: refetchPolicyCount } = useReadContract({
    address: WEATHER_INSURANCE_ADDRESS,
    abi: weatherInsuranceAbi,
    functionName: "policyCount",
    query: { refetchInterval: 10_000 },
  });

  const policyIds = useMemo(() => {
    const n = count ? Number(count) : 0;
    return Array.from({ length: n }, (_, i) => BigInt(i));
  }, [count]);

  const contracts = useMemo(
    () =>
      policyIds.map((id) => ({
        address: WEATHER_INSURANCE_ADDRESS,
        abi: weatherInsuranceAbi,
        functionName: "policies" as const,
        args: [id] as const,
      })),
    [policyIds],
  );

  const { data: policiesData, isLoading, refetch: refetchPolicies } =
    useReadContracts({
      contracts,
      query: { enabled: policyIds.length > 0 },
    });

  const policyCount =
    typeof count === "bigint" ? count : undefined;
  const { data: policyTxHashes } = usePolicyTxHashes(policyCount);

  const rows = useMemo((): PolicyRow[] => {
    if (!policiesData) return [];
    return policiesData.flatMap((item, index) => {
      const p = normalizePolicyReadResult(item.result);
      if (!p) return [];
      const isOwner =
        address?.toLowerCase() === p.policyholder.toLowerCase();
      const settlementOpen = canSettleNow(p.settlementUnlockAt, nowSec);
      const canSettle = isOwner && !p.settled && settlementOpen;
      return [
        {
          index,
          p,
          isOwner,
          settlementOpen,
          canSettle,
          status: policyStatus(p),
          buyTxHash: policyTxHashes?.buy.get(BigInt(index)),
          settlementTxHash: policyTxHashes?.settle.get(BigInt(index)),
        },
      ];
    });
  }, [policiesData, address, nowSec, policyTxHashes]);

  const summary = useMemo(() => {
    let active = 0;
    let paid = 0;
    let noPayout = 0;
    for (const row of rows) {
      if (row.status === "active") active++;
      else if (row.status === "paid") paid++;
      else noPayout++;
    }
    return { total: rows.length, active, paid, noPayout };
  }, [rows]);

  const handleSettle = useCallback(
    async (policyId: bigint) => {
      if (!address) {
        return;
      }
      setSettlingId(policyId);
      try {
        // x402: gateway relays requestSettlement -> poll TEE -> settle(),
        // approving the on-chain settleFee (if any) to the contract first.
        const { settleTx } = await payAndFetch<{ settleTx: `0x${string}` }>(
          "/x402/weather/settle",
          { policyId: policyId.toString(), payer: address },
          execute,
        );

        queryClient.setQueryData(
          policyTxHashesQueryKey(policyCount),
          (prev: PolicyTxHashMaps | undefined) => {
            const settle = new Map(prev?.settle ?? []);
            settle.set(policyId, settleTx);
            return {
              buy: prev?.buy ?? new Map(),
              settle,
            };
          },
        );

        await Promise.all([
          refetchPolicyCount(),
          refetchPolicies(),
          queryClient.invalidateQueries({ queryKey: ["policyTxHashes"] }),
        ]);
      } finally {
        setSettlingId(null);
      }
    },
    [address, execute, policyCount, queryClient, refetchPolicyCount, refetchPolicies],
  );

  if (isLoading && policyIds.length > 0) {
    return (
      <section className="rounded-xl border border-flare-border bg-flare-surface p-6 shadow-sm">
        <h2 className="text-base font-semibold text-flare-ink">Policies</h2>
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-flare-border bg-white"
            />
          ))}
        </div>
      </section>
    );
  }

  if (!count || count === 0n) {
    return (
      <section className="rounded-xl border border-flare-border bg-flare-surface p-6 shadow-sm">
        <h2 className="text-base font-semibold text-flare-ink">Policies</h2>
        <p className="mt-3 text-sm text-flare-muted">
          No policies yet. Buy one above to get started.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-flare-border bg-flare-surface p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-base font-semibold text-flare-ink">Policies</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-white px-2.5 py-1 font-medium text-flare-ink ring-1 ring-flare-border ring-inset">
            {summary.total} total
          </span>
          {summary.active > 0 && (
            <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-800 ring-1 ring-sky-200 ring-inset">
              {summary.active} active
            </span>
          )}
          {summary.paid > 0 && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200 ring-inset">
              {summary.paid} paid
            </span>
          )}
          {summary.noPayout > 0 && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200 ring-inset">
              {summary.noPayout} no payout
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3 md:hidden">
        {rows.map((row) => (
          <PolicyCard
            key={row.index}
            row={row}
            isPending={isPending && settlingId === BigInt(row.index)}
            onSettle={() => handleSettle(BigInt(row.index))}
          />
        ))}
      </div>

      <div className="mt-4 hidden overflow-x-auto rounded-xl border border-flare-border bg-white md:block">
        <table className="w-full min-w-[800px] text-left">
          <thead>
            <tr className="border-b border-flare-border bg-flare-surface/50 text-[11px] font-semibold uppercase tracking-wide text-flare-subtle">
              <th className="px-4 py-3">Policy</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Coverage</th>
              <th className="px-4 py-3">Holder</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PolicyTableRow
                key={row.index}
                row={row}
                isPending={isPending && settlingId === BigInt(row.index)}
                onSettle={() => handleSettle(BigInt(row.index))}
              />
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <PolicyLegend />
    </section>
  );
}
