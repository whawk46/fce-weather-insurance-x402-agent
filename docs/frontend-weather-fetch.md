# Frontend weather FETCH (TEE + x402)

How the dApp loads OpenWeatherMap data after asking the x402 gateway to run `getWeather` on the TEE.

## Entry point

[`frontend/components/LiveWeather.tsx`](../frontend/components/LiveWeather.tsx) calls [`payAndFetch`](../frontend/lib/tee/x402.ts).

`getWeather`/`requestSettlement` on `WeatherInsurance` are `onlyGateway` — the frontend can no longer call them directly. It goes through the Next.js x402 routes at [`frontend/app/x402/weather/`](../frontend/app/x402/weather/) instead.

## Flow

1. **POST `/x402/weather/fetch`** with `{city, payer}` (`payer` = connected wallet).
2. **402 Payment Required** — if the connected wallet's `feeToken` allowance to `WeatherInsurance` is below the configured `fetchFee`, the gateway responds `402` with `{asset, spender, amountBase}`.
3. **Approve** — the frontend calls `feeToken.approve(spender, amountBase)` via the connected wallet, then retries the same POST.
4. **Gateway relays on-chain** — the gateway's wallet (the contract's registered `gateway`) calls `getWeather(city, payer)`. `WeatherInsurance._collectFee` pulls `fetchFee` from `payer` via `transferFrom`, atomically with the instruction — this is the actual enforcement, not the HTTP 402 step above (a direct call to `getWeather` without going through the gateway reverts with `"only gateway"` regardless of allowance).
5. **Poll + decode** — the gateway polls the TEE proxy itself and returns the decoded `WeatherReport` JSON directly in its response.

TEE handler: [`processWeatherFetch`](../internal/extension/extension.go). Gateway handler: [`frontend/lib/server/x402-gateway.ts`](../frontend/lib/server/x402-gateway.ts).

## Configuration

- Contract: `gateway` set to the gateway's wallet address (`setGateway`); `feeToken`/`fetchFee` optional (0/unset disables the fee).
- Gateway: runs inside Next.js (`npm run dev`), using `DEPLOYMENT_PRIVATE_KEY` as its wallet (must match the contract's `gateway`).
- Frontend: `NEXT_PUBLIC_X402_GATEWAY_URL` (gateway base URL — default `http://localhost:3000`; the gateway's 402 response carries the current feeToken address/amount, so the frontend doesn't need it separately), TEE stack running, `OPENWEATHERMAP_API_KEY` in the extension container.
