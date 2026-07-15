import type { BuyPolicyInput } from "@/lib/agent/actions";

import { FlareButton } from "@/components/FlareButton";

export function BuyConfirmCard({
  mode,
  input,
  busy,
  step,
  onConfirm,
  onCancel,
}: {
  mode: "public" | "private";
  input: BuyPolicyInput;
  busy: boolean;
  step: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">
      <p className="font-semibold">
        Confirm {mode === "private" ? "private" : "public"} policy purchase
      </p>
      <dl className="mt-2 grid gap-1 text-violet-900">
        <div>
          <dt className="inline font-medium">Location: </dt>
          <dd className="inline">{input.city}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Date: </dt>
          <dd className="inline">{input.date}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Threshold: </dt>
          <dd className="inline">≥ {input.thresholdMm} mm rain</dd>
        </div>
        <div>
          <dt className="inline font-medium">Payout / premium: </dt>
          <dd className="inline">
            {input.payoutTokens} / {input.premiumTokens} WPT
          </dd>
        </div>
      </dl>
      {mode === "private" && (
        <p className="mt-2 text-xs text-violet-800">
          Terms are ECIES-encrypted; only the TEE sees the threshold on-chain.
        </p>
      )}
      {step && <p className="mt-2 text-xs text-violet-800">{step}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <FlareButton loading={busy} onClick={onConfirm}>
          Confirm & sign
        </FlareButton>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="cursor-pointer rounded-lg border border-violet-300 bg-white px-4 py-2 text-sm font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
