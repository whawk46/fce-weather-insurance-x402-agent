import { geocodeCoords, type GeocodeResult } from "@/lib/geocode";

export type DeviceLocation = GeocodeResult & {
  label: string;
};

function geolocationErrorMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied. Enter a city manually.";
    case error.POSITION_UNAVAILABLE:
      return "Location unavailable. Enter a city manually.";
    case error.TIMEOUT:
      return "Location request timed out. Enter a city manually.";
    default:
      return "Could not get device location. Enter a city manually.";
  }
}

export function getDevicePosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 60_000,
    });
  });
}

export async function getDeviceLocation(): Promise<DeviceLocation> {
  const position = await getDevicePosition();
  const gpsLat = String(position.coords.latitude);
  const gpsLon = String(position.coords.longitude);
  const { lat, lon, label } = await geocodeCoords(gpsLat, gpsLon);
  return { lat, lon, label };
}

export async function getDeviceLocationSafe(): Promise<DeviceLocation> {
  try {
    return await getDeviceLocation();
  } catch (e) {
    if (e instanceof GeolocationPositionError) {
      throw new Error(geolocationErrorMessage(e));
    }
    throw e;
  }
}
