"use client";

import { isToolUIPart } from "ai";

import type { InsuranceAgentUIMessage } from "@/lib/agent/insurance-agent";
import type { BuyPolicyInput } from "@/lib/agent/actions";
import { formatMmE2FromUnknown } from "@/lib/format";

import { BuyConfirmCard } from "./BuyConfirmCard";
import { TxLinks } from "./TxLink";
import { WeatherReportToolCard } from "./WeatherReportToolCard";

type MessagePart = InsuranceAgentUIMessage["parts"][number];

function toolLabel(toolName: string): string {
  switch (toolName) {
    case "geocodeCity":
      return "Geocoding";
    case "getPoolStats":
      return "Pool stats";
    case "listPolicies":
      return "Listing policies";
    case "fetchWeatherX402":
      return "Fetching weather (x402)";
    case "settlePolicyX402":
      return "Settling policy (x402)";
    case "buyPolicy":
      return "Buying public policy";
    case "buyPolicyPrivate":
      return "Buying private policy";
    default:
      return toolName;
  }
}

function txLinksFromOutput(
  toolName: string,
  output: Record<string, unknown>,
): { hash: string; label: string }[] {
  const links: { hash: string; label: string }[] = [];

  if (typeof output.requestTx === "string") {
    links.push({ hash: output.requestTx, label: "Request tx" });
  }
  if (typeof output.settleTx === "string") {
    links.push({ hash: output.settleTx, label: "Settle tx" });
  }
  if (typeof output.buyTxHash === "string") {
    links.push({
      hash: output.buyTxHash,
      label: toolName === "buyPolicyPrivate" ? "Buy tx" : "Policy tx",
    });
  }
  if (typeof output.relayTxHash === "string") {
    links.push({ hash: output.relayTxHash, label: "Relay tx" });
  }

  return links;
}

function renderToolOutput(toolName: string, output: unknown) {
  if (!output || typeof output !== "object") {
    return (
      <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-flare-surface p-2 text-xs text-flare-muted">
        {JSON.stringify(output, null, 2)}
      </pre>
    );
  }

  const record = output as Record<string, unknown>;
  const txLinks = txLinksFromOutput(toolName, record);

  if (toolName === "fetchWeatherX402" && "report" in record) {
    const report = record.report;
    if (report && typeof report === "object") {
      return (
        <>
          <TxLinks links={txLinks} />
          <WeatherReportToolCard
            report={report as Parameters<typeof WeatherReportToolCard>[0]["report"]}
          />
        </>
      );
    }
  }

  if (toolName === "settlePolicyX402") {
    const triggered = record.triggered === true;
    const precip = formatMmE2FromUnknown(record.precipitationMmE2) ?? "—";
    const threshold =
      formatMmE2FromUnknown(record.revealedThresholdMmE2) ??
      formatMmE2FromUnknown(record.rainThresholdMmE2) ??
      "—";

    return (
      <>
        <TxLinks links={txLinks} />
        <p className="mt-2 text-xs text-flare-muted">
          {triggered ? "Payout triggered" : "No payout"} — measured {precip}, threshold{" "}
          {threshold}
          {typeof record.date === "string" ? ` (${record.date})` : ""}
        </p>
      </>
    );
  }

  if (toolName === "buyPolicy" || toolName === "buyPolicyPrivate") {
    return (
      <>
        <TxLinks links={txLinks} />
        <p className="mt-2 text-xs text-flare-muted">
          {toolName === "buyPolicyPrivate" ? "Private" : "Public"} policy purchased for{" "}
          {typeof record.city === "string" ? record.city : "location"} on{" "}
          {typeof record.date === "string" ? record.date : "—"}.
        </p>
      </>
    );
  }

  return (
    <>
      <TxLinks links={txLinks} />
      <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-flare-surface p-2 text-xs text-flare-muted">
        {JSON.stringify(output, null, 2)}
      </pre>
    </>
  );
}

export function ToolPartRenderer({
  part,
  pendingBuy,
  buyBusy,
  buyStep,
  onConfirmBuy,
  onCancelBuy,
}: {
  part: MessagePart;
  pendingBuy?: {
    toolCallId: string;
    toolName: "buyPolicy" | "buyPolicyPrivate";
    input: BuyPolicyInput;
  } | null;
  buyBusy?: boolean;
  buyStep?: string | null;
  onConfirmBuy?: () => void;
  onCancelBuy?: () => void;
}) {
  if (!isToolUIPart(part as Parameters<typeof isToolUIPart>[0])) {
    return null;
  }

  const toolPart = part as {
    type: string;
    toolName?: string;
    toolCallId: string;
    state: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
  const toolName =
    toolPart.type === "dynamic-tool" && toolPart.toolName
      ? toolPart.toolName
      : toolPart.type.replace(/^tool-/, "");
  const input = "input" in toolPart ? toolPart.input : undefined;

  const showBuyConfirm =
    pendingBuy &&
    toolPart.toolCallId === pendingBuy.toolCallId &&
    (toolPart.state === "input-available" || toolPart.state === "input-streaming");

  return (
    <div className="mt-2 rounded-lg border border-flare-border bg-flare-surface px-3 py-2 text-sm">
      <p className="font-medium text-flare-ink">{toolLabel(toolName)}</p>
      {input != null && toolPart.state !== "output-available" && !showBuyConfirm && (
        <pre className="mt-1 text-xs text-flare-muted">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
      {toolPart.state === "input-streaming" && (
        <p className="mt-1 text-xs text-flare-muted">Preparing…</p>
      )}
      {toolPart.state === "input-available" && !showBuyConfirm && (
        <p className="mt-1 text-xs text-flare-muted">Waiting for wallet…</p>
      )}
      {showBuyConfirm && onConfirmBuy && onCancelBuy && (
        <BuyConfirmCard
          mode={pendingBuy.toolName === "buyPolicyPrivate" ? "private" : "public"}
          input={pendingBuy.input}
          busy={!!buyBusy}
          step={buyStep ?? null}
          onConfirm={onConfirmBuy}
          onCancel={onCancelBuy}
        />
      )}
      {toolPart.state === "output-available" && toolPart.output != null && (
        renderToolOutput(toolName, toolPart.output)
      )}
      {toolPart.state === "output-error" && (
        <p className="mt-1 text-xs text-red-600">
          {toolPart.errorText ?? "Tool failed"}
        </p>
      )}
    </div>
  );
}
