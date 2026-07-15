import { createPublicClient, http } from "viem";

import { CHAIN_ID, RPC_URL } from "@/lib/config";

export const publicClient = createPublicClient({
  transport: http(RPC_URL),
  chain: {
    id: CHAIN_ID,
    name: "Coston2",
    nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
});
