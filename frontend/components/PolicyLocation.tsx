"use client";

import { useEffect, useState } from "react";

import { googleMapsUrl, reverseGeocode } from "@/lib/geocode";

export function PolicyLocation({ lat, lon }: { lat: string; lon: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLabel(null);
    setFailed(false);

    reverseGeocode(lat, lon)
      .then((result) => {
        if (!cancelled) setLabel(result.label);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  const mapsUrl = googleMapsUrl(lat, lon);
  const display = label ?? (failed ? `${lat}, ${lon}` : "…");
  const title = `${lat}, ${lon} — Open in Google Maps`;

  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noreferrer"
      className="text-flare-primary hover:underline"
      title={title}
    >
      {display}
    </a>
  );
}
