import { NextResponse } from "next/server";

import { geocodeCoordsServer } from "@/lib/server/geocode";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat")?.trim();
  const lon = url.searchParams.get("lon")?.trim();

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "query parameters lat and lon are required" },
      { status: 400 },
    );
  }

  try {
    const result = await geocodeCoordsServer(lat, lon);
    return NextResponse.json({
      name: result.name,
      country: result.country,
      state: "",
      label: result.label,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Reverse geocoding failed";
    const status = message.includes("not configured")
      ? 503
      : message.includes("valid numbers")
        ? 400
        : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
