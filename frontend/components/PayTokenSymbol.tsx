import { PAY_TOKEN_ADDRESS } from "@/lib/config";
import { explorerAddress, formatTokenAmount } from "@/lib/format";

export function PayTokenSymbol({
  symbol = "WPT",
  className = "text-flare-primary hover:underline",
}: {
  symbol?: string;
  className?: string;
}) {
  return (
    <a
      href={explorerAddress(PAY_TOKEN_ADDRESS)}
      target="_blank"
      rel="noreferrer"
      className={className}
    >
      {symbol}
    </a>
  );
}

export function TokenAmount({
  amount,
  decimals = 18,
  symbol = "WPT",
  symbolClassName,
}: {
  amount: bigint;
  decimals?: number;
  symbol?: string;
  symbolClassName?: string;
}) {
  return (
    <>
      {formatTokenAmount(amount, decimals)}{" "}
      <PayTokenSymbol symbol={symbol} className={symbolClassName} />
    </>
  );
}
