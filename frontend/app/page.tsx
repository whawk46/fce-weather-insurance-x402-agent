"use client";

import { useState } from "react";
import { CloudRain } from "lucide-react";

import { BuyPolicyForm } from "@/components/BuyPolicyForm";
import { ContractSetup } from "@/components/ContractSetup";
import { ConnectButton } from "@/components/ConnectButton";
import { DeviceLocationProvider } from "@/lib/hooks/useDeviceLocation";
import { InsuranceAgentChat } from "@/components/InsuranceAgentChat";
import { LiveWeather } from "@/components/LiveWeather";
import { PolicyList } from "@/components/PolicyList";
import { PoolStats } from "@/components/PoolStats";
import { isConfigured, OPENWEATHERMAP_URL } from "@/lib/config";

export default function HomePage() {
  const [policyRefresh, setPolicyRefresh] = useState(0);

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-flare-border pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-flare-primary text-white">
            <CloudRain className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-flare-primary">
              Flare Confidential Compute
            </p>
            <h1 className="text-xl font-bold text-flare-ink sm:text-2xl">
              Weather Insurance
            </h1>
          </div>
        </div>
        <ConnectButton />
      </header>

      <p className="mt-6 text-sm leading-relaxed text-flare-muted">
        Parametric rainfall insurance for a city you choose at purchase. Policies are
        settled using{" "}
        <a
          href={OPENWEATHERMAP_URL}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-flare-primary hover:underline"
        >
          OpenWeatherMap
        </a>{" "}
        data inside a TEE using{" "}
        <a
          href="https://dev.flare.network/fcc/overview"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-flare-primary hover:underline"
        >
          Flare Confidential Compute
        </a>
        .
      </p>

      {!isConfigured() && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Set contract addresses in <code className="font-mono">frontend/.env.local</code>{" "}
          (see <code className="font-mono">.env.local.example</code>).
        </p>
      )}

      <DeviceLocationProvider>
        <main className="mt-8 flex flex-col gap-8">
          <InsuranceAgentChat onPolicyChange={() => setPolicyRefresh((k) => k + 1)} />
          <ContractSetup />
          <PoolStats />
          <BuyPolicyForm onSuccess={() => setPolicyRefresh((k) => k + 1)} />
          <div key={policyRefresh}>
            <PolicyList />
          </div>
          <LiveWeather />
        </main>
      </DeviceLocationProvider>

      <footer className="mt-12 border-t border-flare-border pt-6 text-center text-xs text-flare-subtle">
        <a
          href="https://dev.flare.network"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-flare-primary hover:underline"
        >
          Flare DevHub
        </a>
        {" · Coston2 testnet · FCC extension demo"}
      </footer>
    </div>
  );
}
