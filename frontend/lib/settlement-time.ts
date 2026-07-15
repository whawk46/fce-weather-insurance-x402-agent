/** Format on-chain settlementUnlockAt for UI (UTC). */
export function formatSettlementUnlock(unlockAtSec: bigint): string {
  const d = new Date(Number(unlockAtSec) * 1000);
  return d.toLocaleString("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Short label for when settlement becomes available (UTC date). */
export function formatSettlementOpensLabel(unlockAtSec: bigint): string {
  const iso = new Date(Number(unlockAtSec) * 1000).toISOString().slice(0, 10);
  return `After midnight on ${iso}`;
}

export function canSettleNow(settlementUnlockAt: bigint, nowSec: bigint): boolean {
  return settlementUnlockAt > 0n && nowSec >= settlementUnlockAt;
}
