"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { Bot, Send } from "lucide-react";
import { useAccount, usePublicClient, useReadContract } from "wagmi";

import { useEnsureExtensionReady } from "@/components/ContractSetup";
import { FlareButton } from "@/components/FlareButton";
import { ToolPartRenderer } from "@/components/agent/ToolPartRenderer";
import type { BuyPolicyInput } from "@/lib/agent/actions";
import {
  buyPrivatePolicy,
  buyPublicPolicy,
  fetchWeatherViaX402,
  settlePolicyViaX402,
} from "@/lib/agent/actions";
import type { InsuranceAgentUIMessage } from "@/lib/agent/insurance-agent";
import {
  type ClientToolName,
} from "@/lib/agent/tools/client-tools";
import { erc20Abi } from "@/lib/abi/erc20";
import { PAY_TOKEN_ADDRESS, WEATHER_INSURANCE_ADDRESS } from "@/lib/config";
import { useTx } from "@/lib/hooks/useTx";
import { useDeviceLocation } from "@/lib/hooks/useDeviceLocation";
import {
  todayIsoDateLocal,
  tomorrowIsoDateLocal,
  resolveCoverageDate,
} from "@/lib/format";

const STARTER_PROMPTS_BASE = [
  "How much liquidity is in the pool?",
  "Show my policies",
] as const;

function buildStarterPrompts(deviceCity: string | undefined) {
  const tomorrow = tomorrowIsoDateLocal();
  const weatherPrompt = deviceCity
    ? `Check weather in ${deviceCity}`
    : "Check weather at my location";
  const buyPrompt = deviceCity
    ? `Buy private coverage for ${deviceCity} on ${tomorrow} — 2mm threshold, 10 WPT payout, 1 WPT premium`
    : `Buy private coverage for my location on ${tomorrow} — 2mm threshold, 10 WPT payout, 1 WPT premium`;
  return [...STARTER_PROMPTS_BASE, weatherPrompt, buyPrompt];
}

function toolNameFromPart(part: {
  type: string;
  toolName?: string;
}): ClientToolName | null {
  const name =
    part.type === "dynamic-tool" && part.toolName
      ? part.toolName
      : part.type.startsWith("tool-")
        ? part.type.slice("tool-".length)
        : null;
  if (
    name === "fetchWeatherX402" ||
    name === "settlePolicyX402" ||
    name === "buyPolicy" ||
    name === "buyPolicyPrivate"
  ) {
    return name;
  }
  return null;
}

function recentUserText(
  messages: InsuranceAgentUIMessage[],
  fallback: string,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .trim();
    if (text) return text;
  }
  return fallback;
}

function normalizeBuyInput(input: BuyPolicyInput, userText: string): BuyPolicyInput {
  return {
    ...input,
    date: resolveCoverageDate(input.date, { userText }),
  };
}

function parseBuyInput(input: unknown, userText = ""): BuyPolicyInput | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (
    typeof o.city !== "string" ||
    typeof o.date !== "string" ||
    typeof o.thresholdMm !== "string" ||
    typeof o.payoutTokens !== "string" ||
    typeof o.premiumTokens !== "string"
  ) {
    return null;
  }
  return normalizeBuyInput(
    {
      city: o.city,
      date: o.date,
      thresholdMm: o.thresholdMm,
      payoutTokens: o.payoutTokens,
      premiumTokens: o.premiumTokens,
    },
    userText,
  );
}

export function InsuranceAgentChat({
  onPolicyChange,
}: {
  onPolicyChange?: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { city: deviceCity } = useDeviceLocation();
  const publicClient = usePublicClient();
  const { execute } = useTx();
  const { ensureReady } = useEnsureExtensionReady();
  const [input, setInput] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [toolStep, setToolStep] = useState<string | null>(null);
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyStep, setBuyStep] = useState<string | null>(null);
  const [pendingBuy, setPendingBuy] = useState<{
    toolCallId: string;
    toolName: "buyPolicy" | "buyPolicyPrivate";
    input: BuyPolicyInput;
  } | null>(null);

  const processedToolCalls = useRef(new Set<string>());
  const lastUserText = useRef("");
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const todayDate = useMemo(() => todayIsoDateLocal(), []);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: PAY_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, WEATHER_INSURANCE_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport<InsuranceAgentUIMessage>({
        api: "/api/chat",
        body: {
          walletAddress: address,
          deviceCity: deviceCity || undefined,
          todayDate,
        },
      }),
    [address, deviceCity, todayDate],
  );

  const starterPrompts = useMemo(
    () => buildStarterPrompts(deviceCity || undefined),
    [deviceCity],
  );

  const { messages, sendMessage, status, error, addToolOutput } =
    useChat<InsuranceAgentUIMessage>({
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    });

  useEffect(() => {
    if (error?.message.includes("503") || error?.message.includes("OPENAI_API_KEY")) {
      setConfigError(
        "Set OPENAI_API_KEY in frontend/.env.local to enable the AI agent.",
      );
    }
  }, [error]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;

    const frame = requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: status === "streaming" ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, status, toolStep, pendingBuy, buyStep, buyBusy]);

  const runClientTool = useCallback(
    async (toolName: ClientToolName, toolCallId: string, input: unknown) => {
      if (!address) {
        await addToolOutput({
          tool: toolName,
          toolCallId,
          state: "output-error",
          errorText: "Connect your wallet on Coston2 first.",
        });
        return;
      }

      try {
        setToolStep(null);

        if (toolName === "fetchWeatherX402") {
          const city =
            input && typeof input === "object" && "city" in input
              ? String((input as { city: string }).city)
              : "";
          const output = await fetchWeatherViaX402(city, address, execute, setToolStep);
          await addToolOutput({ tool: toolName, toolCallId, output });
          return;
        }

        if (toolName === "settlePolicyX402") {
          const policyId =
            input && typeof input === "object" && "policyId" in input
              ? Number((input as { policyId: number }).policyId)
              : NaN;
          const output = await settlePolicyViaX402(
            policyId,
            address,
            execute,
            setToolStep,
            publicClient,
          );
          await addToolOutput({ tool: toolName, toolCallId, output });
          onPolicyChange?.();
          return;
        }
      } catch (e) {
        await addToolOutput({
          tool: toolName,
          toolCallId,
          state: "output-error",
          errorText: e instanceof Error ? e.message : "Wallet action failed",
        });
      } finally {
        setToolStep(null);
      }
    },
    [address, addToolOutput, execute, onPolicyChange, publicClient],
  );

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;

    for (const part of last.parts) {
      if (!isToolUIPart(part)) continue;
      if (part.state !== "input-available") continue;
      if (processedToolCalls.current.has(part.toolCallId)) continue;

      const toolName = toolNameFromPart(part);
      if (!toolName) continue;

      if (toolName === "buyPolicy" || toolName === "buyPolicyPrivate") {
        const buyInput = parseBuyInput(
          part.input,
          recentUserText(messages, lastUserText.current),
        );
        if (!buyInput) continue;
        processedToolCalls.current.add(part.toolCallId);
        setPendingBuy({
          toolCallId: part.toolCallId,
          toolName,
          input: buyInput,
        });
        continue;
      }

      if (toolName === "fetchWeatherX402" || toolName === "settlePolicyX402") {
        processedToolCalls.current.add(part.toolCallId);
        void runClientTool(toolName, part.toolCallId, part.input);
      }
    }
  }, [messages, runClientTool]);

  const handleConfirmBuy = useCallback(async () => {
    if (!pendingBuy || !address) return;

    const { toolCallId, toolName } = pendingBuy;
    const buyInput = normalizeBuyInput(
      pendingBuy.input,
      recentUserText(messages, lastUserText.current),
    );
    setBuyBusy(true);
    setBuyStep(null);

    try {
      const common = {
        onStep: setBuyStep,
        ensureReady,
        publicClient,
        allowance: typeof allowance === "bigint" ? allowance : undefined,
        refetchAllowance,
      };

      const output =
        toolName === "buyPolicyPrivate"
          ? await buyPrivatePolicy(buyInput, address, execute, common)
          : await buyPublicPolicy(buyInput, address, execute, common);

      await addToolOutput({ tool: toolName, toolCallId, output });
      onPolicyChange?.();
      setPendingBuy(null);
    } catch (e) {
      await addToolOutput({
        tool: toolName,
        toolCallId,
        state: "output-error",
        errorText: e instanceof Error ? e.message : "Purchase failed",
      });
      setPendingBuy(null);
    } finally {
      setBuyBusy(false);
      setBuyStep(null);
    }
  }, [
    addToolOutput,
    address,
    allowance,
    ensureReady,
    execute,
    onPolicyChange,
    pendingBuy,
    publicClient,
    refetchAllowance,
    messages,
  ]);

  const handleCancelBuy = useCallback(async () => {
    if (!pendingBuy) return;
    await addToolOutput({
      tool: pendingBuy.toolName,
      toolCallId: pendingBuy.toolCallId,
      state: "output-error",
      errorText: "Purchase cancelled by user.",
    });
    setPendingBuy(null);
  }, [addToolOutput, pendingBuy]);

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === "streaming" || status === "submitted") return;
      lastUserText.current = trimmed;
      setInput("");
      setConfigError(null);
      await sendMessage({ text: trimmed });
    },
    [sendMessage, status],
  );

  const isBusy = status === "streaming" || status === "submitted" || buyBusy;

  return (
    <section className="rounded-2xl border border-flare-border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-flare-primary/10 text-flare-primary">
          <Bot className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-flare-ink">Insurance assistant</h2>
          <p className="mt-1 text-sm text-flare-muted">
            Chat to check weather via x402, buy policies, list coverage, and settle —
            powered by OpenAI with on-chain tools.
          </p>
        </div>
      </div>

      {configError && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {configError}
        </p>
      )}

      {!isConnected && (
        <p className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Connect your wallet to fetch weather, buy, or settle via the agent.
          Pool stats and geocoding work without a wallet.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {starterPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={isBusy}
            onClick={() => void handleSubmit(prompt)}
            className="cursor-pointer rounded-full border border-flare-border bg-flare-surface px-3 py-1.5 text-left text-xs text-flare-muted transition-colors hover:border-flare-primary hover:text-flare-ink disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
      </div>

      <div
        ref={chatScrollRef}
        className="mt-4 max-h-[28rem] space-y-4 overflow-y-auto rounded-xl border border-flare-border bg-flare-surface/50 p-4"
      >
        {messages.length === 0 && (
          <p className="text-sm text-flare-muted">
            Ask about pool liquidity, live TEE weather, or buying parametric rain
            coverage.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-8 rounded-xl bg-flare-primary px-4 py-2.5 text-sm text-white"
                : "mr-4 rounded-xl border border-flare-border bg-white px-4 py-2.5 text-sm text-flare-ink"
            }
          >
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return (
                  <p key={index} className="whitespace-pre-wrap">
                    {part.text}
                  </p>
                );
              }
              return (
                <ToolPartRenderer
                  key={index}
                  part={part}
                  pendingBuy={pendingBuy}
                  buyBusy={buyBusy}
                  buyStep={buyStep}
                  onConfirmBuy={() => void handleConfirmBuy()}
                  onCancelBuy={() => void handleCancelBuy()}
                />
              );
            })}
          </div>
        ))}
        {toolStep && (
          <p className="text-xs text-flare-muted">{toolStep}</p>
        )}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit(input);
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the insurance assistant…"
          disabled={isBusy}
          className="min-w-0 flex-1 rounded-lg border border-flare-border bg-white px-3 py-2.5 text-sm text-flare-ink"
        />
        <FlareButton type="submit" loading={isBusy} disabled={!input.trim()}>
          <Send className="h-4 w-4" aria-hidden />
          <span className="sr-only">Send</span>
        </FlareButton>
      </form>

      {error && !configError && (
        <p className="mt-2 text-sm text-red-600">{error.message}</p>
      )}
    </section>
  );
}
