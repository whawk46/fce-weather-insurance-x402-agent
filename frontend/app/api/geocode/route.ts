import { NextResponse } from "next/server";

import { geocodeCityServer, geocodeCoordsServer } from "@/lib/server/geocode";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const lat = url.searchParams.get("lat")?.trim();
  const lon = url.searchParams.get("lon")?.trim();

  if (!q && (!lat || !lon)) {
    return NextResponse.json(
      { error: "provide query parameter q or lat and lon" },
      { status: 400 },
    );
  }

  try {
    const result =
      lat && lon ? await geocodeCoordsServer(lat, lon) : await geocodeCityServer(q!);
    return NextResponse.json({
      lat: result.lat,
      lon: result.lon,
      label: result.label,
      name: result.name,
      country: result.country,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Geocoding failed";
    const status = message.includes("not configured")
      ? 503
      : message.includes("required") || message.includes("valid numbers")
        ? 400
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
