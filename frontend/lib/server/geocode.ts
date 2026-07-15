const OPENWEATHER_WEATHER_URL = "https://api.openweathermap.org/data/2.5/weather";

function formatCoord(value: number): string {
  return Number(value.toFixed(4)).toString();
}

export type GeocodeServerResult = {
  lat: string;
  lon: string;
  label: string;
  name: string;
  country: string;
};

export function formatOwmCityLabel(name: string, country: string): string {
  const trimmedName = name.trim();
  const trimmedCountry = country.trim();
  return trimmedCountry ? `${trimmedName},${trimmedCountry}` : trimmedName;
}

function getApiKey(): string {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENWEATHERMAP_API_KEY is not configured on the server. " +
        "Set it in frontend/.env.local or frontend/.env.",
    );
  }
  return apiKey;
}

async function fetchOwmWeather(
  params: URLSearchParams,
): Promise<GeocodeServerResult> {
  params.set("units", "metric");
  params.set("appid", getApiKey());

  const res = await fetch(`${OPENWEATHER_WEATHER_URL}?${params}`, {
    next: { revalidate: 3600 },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`OpenWeatherMap returned ${res.status}: ${body.slice(0, 200)}`);
  }

  let parsed: {
    coord?: { lat?: number; lon?: number };
    name?: string;
    sys?: { country?: string };
  };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    throw new Error("Invalid OpenWeatherMap response");
  }

  const lat = parsed.coord?.lat;
  const lon = parsed.coord?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") {
    throw new Error("Coordinates missing from geocode response");
  }

  const name = parsed.name?.trim() ?? "";
  const country = parsed.sys?.country?.trim() ?? "";
  if (!name) {
    throw new Error("OpenWeatherMap returned no place name");
  }

  return {
    lat: formatCoord(lat),
    lon: formatCoord(lon),
    name,
    country,
    label: formatOwmCityLabel(name, country),
  };
}

export async function geocodeCityServer(city: string): Promise<GeocodeServerResult> {
  const trimmed = city.trim();
  if (!trimmed) {
    throw new Error("City is required (e.g. Berlin,DE)");
  }

  return fetchOwmWeather(new URLSearchParams({ q: trimmed }));
}

export async function geocodeCoordsServer(
  lat: string,
  lon: string,
): Promise<GeocodeServerResult> {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    throw new Error("lat and lon must be valid numbers");
  }

  return fetchOwmWeather(
    new URLSearchParams({ lat: String(latNum), lon: String(lonNum) }),
  );
}
