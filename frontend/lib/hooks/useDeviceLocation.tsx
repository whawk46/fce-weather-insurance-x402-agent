"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { GeocodeResult } from "@/lib/geocode";
import { getDeviceLocationSafe } from "@/lib/geolocation";

type DeviceLocationState = {
  city: string;
  coords: GeocodeResult | null;
  loading: boolean;
  error: string | null;
  setCity: (city: string) => void;
  refresh: () => Promise<void>;
};

const DeviceLocationContext = createContext<DeviceLocationState | null>(null);

export function DeviceLocationProvider({ children }: { children: ReactNode }) {
  const [city, setCityState] = useState("");
  const [coords, setCoords] = useState<GeocodeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { lat, lon, label } = await getDeviceLocationSafe();
      setCityState(label);
      setCoords({ lat, lon });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Location unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setCity = useCallback((newCity: string) => {
    setCityState(newCity);
    setCoords(null);
  }, []);

  const value = useMemo(
    () => ({ city, coords, loading, error, setCity, refresh: load }),
    [city, coords, loading, error, setCity, load],
  );

  return (
    <DeviceLocationContext.Provider value={value}>
      {children}
    </DeviceLocationContext.Provider>
  );
}

export function useDeviceLocation(): DeviceLocationState {
  const ctx = useContext(DeviceLocationContext);
  if (!ctx) {
    throw new Error("useDeviceLocation must be used within DeviceLocationProvider");
  }
  return ctx;
}
