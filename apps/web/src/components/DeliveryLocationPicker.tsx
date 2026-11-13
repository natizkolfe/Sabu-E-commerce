"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";

export type DeliveryLocationValue = {
  lng: number;
  lat: number;
  addressText: string;
  formattedAddress: string;
  landmarkName: string | null;
  landmarkPlaceId: string | null;
  landmarkLng: number | null;
  landmarkLat: number | null;
  deliveryInstructions: string;
  locationType: "exact" | "landmark_nearby";
  locationSource: "gps" | "search" | "manual_pin" | "assisted";
  confirmed: boolean;
};

type PlaceHit = {
  id: string;
  name: string;
  area: string;
  city: string;
  placeId: string | null;
  category: string;
  lng: number;
  lat: number;
  source?: "landmark" | "geocode";
  formattedAddress?: string;
};

const ADDIS = { lng: 38.789, lat: 8.9806 };

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

type Props = {
  value: DeliveryLocationValue;
  onChange: (next: DeliveryLocationValue) => void;
};

export function DeliveryLocationPicker({ value, onChange }: Props) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [quickLandmarks, setQuickLandmarks] = useState<PlaceHit[]>([]);
  const [results, setResults] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const previewUrl = useMemo(() => {
    if (!value.confirmed) return null;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${value.lng - 0.02}%2C${value.lat - 0.015}%2C${value.lng + 0.02}%2C${value.lat + 0.015}&layer=mapnik&marker=${value.lat}%2C${value.lng}`;
  }, [value]);

  useEffect(() => {
    fetch(`${API_URL}/delivery/landmarks?city=${encodeURIComponent("Addis Ababa")}`)
      .then((r) => r.json())
      .then((rows: PlaceHit[]) =>
        setQuickLandmarks(Array.isArray(rows) ? rows.slice(0, 8) : []),
      )
      .catch(() => setQuickLandmarks([]));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(() => {
      fetch(`${API_URL}/delivery/places/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((rows: PlaceHit[]) => {
          if (!cancelled) setResults(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!mapEl.current || mapRef.current) return;
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");

      // Fix default marker icons in bundlers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (cancelled || !mapEl.current) return;
      const map = L.map(mapEl.current, {
        attributionControl: false,
      }).setView([value.lat, value.lng], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "",
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker([value.lat, value.lng], { draggable: true }).addTo(
        map,
      );
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        const cur = valueRef.current;
        onChangeRef.current({
          ...cur,
          lat: p.lat,
          lng: p.lng,
          locationSource: "manual_pin",
          locationType: cur.landmarkName ? "landmark_nearby" : "exact",
          confirmed: false,
          formattedAddress:
            cur.formattedAddress || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
        });
      });
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        marker.setLatLng(e.latlng);
        const cur = valueRef.current;
        onChangeRef.current({
          ...cur,
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          locationSource: "manual_pin",
          locationType: cur.landmarkName ? "landmark_nearby" : "exact",
          confirmed: false,
        });
      });

      mapRef.current = map;
      markerRef.current = marker;
      setMapReady(true);
    }
    init();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapReady || !markerRef.current || !mapRef.current) return;
    markerRef.current.setLatLng([value.lat, value.lng]);
    mapRef.current.setView([value.lat, value.lng]);
  }, [value.lat, value.lng, mapReady]);

  function pickPlace(lm: PlaceHit) {
    const formatted =
      lm.formattedAddress || `${lm.name} — ${lm.area}, ${lm.city}`;
    onChange({
      ...value,
      lat: lm.lat,
      lng: lm.lng,
      landmarkName: lm.name,
      landmarkPlaceId: lm.placeId,
      landmarkLat: lm.lat,
      landmarkLng: lm.lng,
      addressText: formatted,
      formattedAddress: formatted,
      locationType: "landmark_nearby",
      locationSource: "search",
      confirmed: false,
    });
    setQuery(lm.name);
    setResults([]);
  }

  function useMyLocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("GPS is not available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          ...value,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          locationSource: "gps",
          locationType: value.landmarkName ? "landmark_nearby" : "exact",
          formattedAddress: `GPS ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
          confirmed: false,
        });
      },
      () => setGeoError("Location permission denied or unavailable."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function confirm() {
    onChange({
      ...value,
      confirmed: true,
      addressText:
        value.addressText ||
        value.formattedAddress ||
        `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`,
      formattedAddress:
        value.formattedAddress ||
        value.addressText ||
        `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`,
    });
  }

  const listToShow =
    query.trim().length >= 2 ? results : quickLandmarks;

  if (value.confirmed) {
    return (
      <div className="space-y-3 border border-sabu-mist/60 px-4 py-4">
        <p className="text-xs tracking-wide text-sabu-moss uppercase">
          Delivery location confirmed
        </p>
        <p className="text-sm text-sabu-ink">
          {value.landmarkName
            ? `Landmark: ${value.landmarkName}`
            : "Exact pin destination"}
        </p>
        <p className="text-sm text-sabu-moss">
          {value.formattedAddress || value.addressText}
        </p>
        {value.deliveryInstructions && (
          <p className="text-sm text-sabu-moss">
            Instructions: {value.deliveryInstructions}
          </p>
        )}
        {previewUrl && (
          <iframe
            title="Delivery map preview"
            src={previewUrl}
            className="h-40 w-full border border-sabu-mist/40"
          />
        )}
        <button
          type="button"
          onClick={() => onChange({ ...value, confirmed: false })}
          className="text-sm text-sabu-leaf underline"
        >
          Edit location
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="font-[family-name:var(--font-syne)] text-xl text-sabu-ink">
        Delivery Location
      </h2>
      <p className="text-sm text-sabu-moss">
        Drop a pin or choose a nearby landmark (bank, mall, hotel). Map starts in
        Addis Ababa.
      </p>

      <label className="block text-sm text-sabu-moss">
        Search address or nearby landmark
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. CBE Bole, Friendship Business Center, Addis Ababa University"
          className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-2 outline-none focus:border-sabu-leaf"
        />
      </label>
      {searching && (
        <p className="text-xs text-sabu-moss">Searching locations…</p>
      )}
      {query.trim().length >= 2 && !searching && listToShow.length === 0 && (
        <p className="text-xs text-sabu-moss">
          No matches found — drop a pin on the map and add instructions below.
        </p>
      )}
      {query.trim().length < 2 && (
        <p className="text-xs text-sabu-moss">
          Popular landmarks (or type to search real places):
        </p>
      )}

      {listToShow.length > 0 && (
        <ul className="max-h-44 overflow-y-auto border border-sabu-mist/50 text-sm">
          {listToShow.slice(0, 10).map((lm) => (
            <li key={lm.id}>
              <button
                type="button"
                onClick={() => pickPlace(lm)}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-sabu-mist/20"
              >
                <span className="text-sabu-ink">{lm.name}</span>
                <span className="text-xs text-sabu-moss">
                  {lm.formattedAddress || `${lm.area}, ${lm.city}`}
                  {lm.source === "geocode" ? " · map" : " · landmark"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          className="border border-sabu-moss/40 px-3 py-2 text-xs text-sabu-ink"
        >
          Use my current location
        </button>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              lat: ADDIS.lat,
              lng: ADDIS.lng,
              locationSource: "manual_pin",
              confirmed: false,
            })
          }
          className="border border-sabu-moss/40 px-3 py-2 text-xs text-sabu-ink"
        >
          Reset to Addis Ababa
        </button>
      </div>
      {geoError && <p className="text-xs text-red-700">{geoError}</p>}

      <div
        ref={mapEl}
        className="h-64 w-full border border-sabu-mist/60 bg-sabu-mist/20"
      />
      <p className="text-xs text-sabu-moss">
        Tap the map to drop a pin, or drag the marker. Landmark is a navigation
        reference — add building directions below.
      </p>

      <label className="block text-sm text-sabu-moss">
        Selected landmark name
        <input
          value={value.landmarkName ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              landmarkName: e.target.value || null,
              locationType: e.target.value ? "landmark_nearby" : "exact",
              confirmed: false,
            })
          }
          placeholder="Optional — e.g. CBE Bole Branch"
          className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-2 outline-none"
        />
      </label>

      <label className="block text-sm text-sabu-moss">
        Selected address / area
        <input
          value={value.addressText}
          onChange={(e) =>
            onChange({
              ...value,
              addressText: e.target.value,
              formattedAddress: e.target.value,
              confirmed: false,
            })
          }
          required
          className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-2 outline-none"
        />
      </label>

      <label className="block text-sm text-sabu-moss">
        Additional delivery instructions
        <textarea
          value={value.deliveryInstructions}
          onChange={(e) =>
            onChange({
              ...value,
              deliveryInstructions: e.target.value,
              confirmed: false,
            })
          }
          rows={3}
          placeholder='e.g. "Behind the bank, second building on the right, 2nd floor"'
          className="mt-1 w-full border border-sabu-mist bg-transparent px-3 py-2 outline-none focus:border-sabu-leaf"
        />
      </label>

      <p className="text-xs text-sabu-moss">
        Pin: {value.lat.toFixed(5)}, {value.lng.toFixed(5)} ·{" "}
        {value.locationType === "landmark_nearby"
          ? "Landmark reference"
          : "Exact destination"}
      </p>

      <button
        type="button"
        onClick={confirm}
        className="w-full bg-sabu-ink px-4 py-3 text-sm text-sabu-cream"
      >
        Confirm delivery location
      </button>
    </div>
  );
}
