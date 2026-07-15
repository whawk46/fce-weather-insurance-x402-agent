"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { flareTestnet } from "viem/chains";

import { FlareButton } from "./FlareButton";
import { shortenAddress } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const wrongNetwork = isConnected && chain?.id !== flareTestnet.id;
  const injected = connectors[0];

  if (!isConnected) {
    return (
      <FlareButton
        loading={isConnecting}
        onClick={() => injected && connect({ connector: injected, chainId: flareTestnet.id })}
      >
        Connect wallet
      </FlareButton>
    );
  }

  if (wrongNetwork) {
    return (
      <FlareButton
        loading={isSwitching}
        onClick={() => switchChain({ chainId: flareTestnet.id })}
      >
        Switch to Coston2
      </FlareButton>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-sm text-flare-muted">
        {address ? shortenAddress(address) : null}
      </span>
      <FlareButton variant="secondary" onClick={() => disconnect()}>
        Disconnect
      </FlareButton>
    </div>
  );
}
