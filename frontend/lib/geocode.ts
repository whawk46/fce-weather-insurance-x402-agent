export type GeocodeResult = {
  lat: string;
  lon: string;
};

export type GeocodeWithLabel = GeocodeResult & {
  label: string;
  name: string;
  country: string;
};

export type ReverseGeocodeResult = {
  name: string;
  country: string;
  state: string;
  label: string;
};

const reverseGeocodeCache = new Map<string, Promise<ReverseGeocodeResult>>();

export function googleMapsUrl(lat: string, lon: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}`;
}

export async function reverseGeocode(lat: string, lon: string): Promise<ReverseGeocodeResult> {
  const key = `${lat},${lon}`;
  let pending = reverseGeocodeCache.get(key);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(
        `/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
      );
      const data = (await res.json()) as ReverseGeocodeResult & {
        error?: string;
        detail?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? `Reverse geocoding failed (${res.status})`);
      }

      if (!data.label) {
        throw new Error("Reverse geocoding returned no place name");
      }

      return data;
    })();
    reverseGeocodeCache.set(key, pending);
  }
  return pending;
}

export async function geocodeCity(city: string): Promise<GeocodeWithLabel> {
  const trimmed = city.trim();
  if (!trimmed) {
    throw new Error("Enter a location (e.g. Berlin,DE)");
  }

  const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
  const data = (await res.json()) as GeocodeWithLabel & { error?: string; detail?: string };

  if (!res.ok) {
    throw new Error(data.error ?? `Geocoding failed (${res.status})`);
  }

  if (!data.lat || !data.lon || !data.label) {
    throw new Error("Geocoding returned no coordinates");
  }

  return data;
}

export async function geocodeCoords(lat: string, lon: string): Promise<GeocodeWithLabel> {
  const res = await fetch(
    `/api/geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
  );
  const data = (await res.json()) as GeocodeWithLabel & { error?: string; detail?: string };

  if (!res.ok) {
    throw new Error(data.error ?? `Geocoding failed (${res.status})`);
  }

  if (!data.lat || !data.lon || !data.label) {
    throw new Error("Geocoding returned no coordinates");
  }

  return data;
}
