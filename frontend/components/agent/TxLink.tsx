import { explorerTx, shortenHash } from "@/lib/format";

export function TxLink({
  hash,
  label,
}: {
  hash: string;
  label?: string;
}) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-flare-primary hover:underline"
    >
      {label ?? shortenHash(hash)}
    </a>
  );
}

export function TxLinks({
  links,
}: {
  links: { hash: string; label: string }[];
}) {
  if (links.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-flare-muted">
      {links.map(({ hash, label }) => (
        <span key={`${label}-${hash}`}>
          <span className="font-medium text-flare-ink">{label}: </span>
          <TxLink hash={hash} />
        </span>
      ))}
    </div>
  );
}
