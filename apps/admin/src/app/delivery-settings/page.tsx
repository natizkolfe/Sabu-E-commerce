"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

type Settings = Awaited<ReturnType<typeof adminApi.getDispatchSettings>>;

export default function DeliverySettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    adminApi
      .getDispatchSettings(s.accessToken)
      .then(setSettings)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Load failed"),
      );
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !settings) return;
    setError(null);
    try {
      const next = await adminApi.updateDispatchSettings(token, {
        offerTtlMinutes: settings.offerTtlMinutes,
        defaultSpeedKmh: settings.defaultSpeedKmh,
        feePerKm: settings.feePerKm,
        minFee: settings.minFee,
        maxFee: settings.maxFee,
        freeOverAmount: settings.freeOverAmount,
        originLng: settings.originLng,
        originLat: settings.originLat,
        standardEnabled: settings.standardEnabled,
        expressEnabled: settings.expressEnabled,
        standardBaseFare: settings.standardBaseFare,
        expressBaseFare: settings.expressBaseFare,
        expressFeePerKm: settings.expressFeePerKm,
        expressSurcharge: settings.expressSurcharge,
        peakSurcharge: settings.peakSurcharge,
        holidaySurcharge: settings.holidaySurcharge,
        standardEtaBufferMinutes: settings.standardEtaBufferMinutes,
        expressEtaBufferMinutes: settings.expressEtaBufferMinutes,
        expressSpeedKmh: settings.expressSpeedKmh,
        promoDiscountAmount: settings.promoDiscountAmount,
        promoDiscountPercent: settings.promoDiscountPercent,
        promoLabel: settings.promoLabel,
        etaDisclaimer: settings.etaDisclaimer,
      });
      setSettings(next);
      setMessage(
        "Delivery pricing saved. New checkouts use these rates; past orders keep their snapshots.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <p>Sign in from the home page first.</p>
        <Link href="/?modules=1" className="mt-4 inline-block text-[#8aa897]">
          ← Admin home
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] px-6 py-12 text-[#eef2ef]">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link href="/?modules=1" className="text-sm text-[#8aa897]">
            ← Admin
          </Link>
          <h1 className="mt-4 text-3xl">Delivery pricing</h1>
          <p className="mt-2 text-sm text-[#9eb0a6]">
            Origin: Kolfe Atena Tera. Standard fee = base fare + (km × rate).
            Express stays unavailable until you set an Express km rate and enable
            it. Changes are audited and do not rewrite historical orders.
          </p>
        </div>

        {message && <p className="text-sm text-[#2f6b4f]">{message}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {settings && (
          <form onSubmit={onSave} className="space-y-6 border border-[#24302a] p-4">
            <p className="text-sm text-[#b7c7be]">
              {settings.originName} — {settings.originAddress}
            </p>

            <section className="space-y-3">
              <h2 className="text-sm text-[#8aa897]">Service availability</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.standardEnabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      standardEnabled: e.target.checked,
                    })
                  }
                />
                Enable Standard delivery
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.expressEnabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      expressEnabled: e.target.checked,
                    })
                  }
                />
                Enable Express delivery
              </label>
              {!settings.expressConfigured && (
                <p className="text-xs text-amber-400">
                  Express is unavailable until Express ETB/km is set.
                </p>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <h2 className="sm:col-span-2 text-sm text-[#8aa897]">
                Standard pricing
              </h2>
              <Num
                label="Standard base fare (ETB)"
                value={settings.standardBaseFare}
                onChange={(n) =>
                  setSettings({ ...settings, standardBaseFare: n })
                }
              />
              <Num
                label="Standard rate per km (ETB)"
                value={settings.feePerKm}
                onChange={(n) => setSettings({ ...settings, feePerKm: n })}
              />
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <h2 className="sm:col-span-2 text-sm text-[#8aa897]">
                Express pricing
              </h2>
              <Num
                label="Express base fare (ETB)"
                value={settings.expressBaseFare}
                onChange={(n) =>
                  setSettings({ ...settings, expressBaseFare: n })
                }
              />
              <label className="block text-sm text-[#9eb0a6]">
                Express rate per km (ETB)
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2"
                  value={settings.expressFeePerKm ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      expressFeePerKm:
                        e.target.value === ""
                          ? null
                          : Number(e.target.value),
                    })
                  }
                />
              </label>
              <Num
                label="Express surcharge (ETB)"
                value={settings.expressSurcharge}
                onChange={(n) =>
                  setSettings({ ...settings, expressSurcharge: n })
                }
              />
              <label className="block text-sm text-[#9eb0a6]">
                Express speed (km/h, blank = auto)
                <input
                  type="number"
                  step="0.1"
                  min={1}
                  className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2"
                  value={settings.expressSpeedKmh ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      expressSpeedKmh:
                        e.target.value === ""
                          ? null
                          : Number(e.target.value),
                    })
                  }
                />
              </label>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <h2 className="sm:col-span-2 text-sm text-[#8aa897]">
                Caps, promos & peak
              </h2>
              <label className="block text-sm text-[#9eb0a6]">
                Maximum fee (blank = none)
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2"
                  value={settings.maxFee ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxFee:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="block text-sm text-[#9eb0a6]">
                Free over subtotal (blank = none)
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2"
                  value={settings.freeOverAmount ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      freeOverAmount:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <Num
                label="Peak surcharge (ETB)"
                value={settings.peakSurcharge}
                onChange={(n) =>
                  setSettings({ ...settings, peakSurcharge: n })
                }
              />
              <Num
                label="Holiday surcharge (ETB)"
                value={settings.holidaySurcharge}
                onChange={(n) =>
                  setSettings({ ...settings, holidaySurcharge: n })
                }
              />
              <Num
                label="Promo discount amount (ETB)"
                value={settings.promoDiscountAmount}
                onChange={(n) =>
                  setSettings({ ...settings, promoDiscountAmount: n })
                }
              />
              <Num
                label="Promo discount %"
                value={settings.promoDiscountPercent}
                onChange={(n) =>
                  setSettings({ ...settings, promoDiscountPercent: n })
                }
              />
              <label className="sm:col-span-2 block text-sm text-[#9eb0a6]">
                Promo label
                <input
                  className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2"
                  value={settings.promoLabel ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      promoLabel: e.target.value || null,
                    })
                  }
                />
              </label>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <h2 className="sm:col-span-2 text-sm text-[#8aa897]">
                ETA estimates (not guarantees)
              </h2>
              <Num
                label="Default speed km/h"
                value={settings.defaultSpeedKmh}
                onChange={(n) =>
                  setSettings({ ...settings, defaultSpeedKmh: n })
                }
              />
              <Num
                label="Driver portal token lifetime (minutes, legacy setting)"
                value={settings.offerTtlMinutes}
                onChange={(n) =>
                  setSettings({ ...settings, offerTtlMinutes: n })
                }
              />
              <Num
                label="Standard ETA buffer (min)"
                value={settings.standardEtaBufferMinutes}
                onChange={(n) =>
                  setSettings({ ...settings, standardEtaBufferMinutes: n })
                }
              />
              <Num
                label="Express ETA buffer (min)"
                value={settings.expressEtaBufferMinutes}
                onChange={(n) =>
                  setSettings({ ...settings, expressEtaBufferMinutes: n })
                }
              />
              <label className="sm:col-span-2 block text-sm text-[#9eb0a6]">
                Customer ETA disclaimer
                <textarea
                  rows={3}
                  className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2"
                  value={settings.etaDisclaimer}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      etaDisclaimer: e.target.value,
                    })
                  }
                />
              </label>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <Num
                label="Origin longitude"
                value={settings.originLng}
                step="0.0001"
                onChange={(n) => setSettings({ ...settings, originLng: n })}
              />
              <Num
                label="Origin latitude"
                value={settings.originLat}
                step="0.0001"
                onChange={(n) => setSettings({ ...settings, originLat: n })}
              />
            </section>

            <button
              type="submit"
              className="bg-[#2f6b4f] px-4 py-2 text-sm text-white"
            >
              Save pricing
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function Num({
  label,
  value,
  onChange,
  step = "0.01",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: string;
}) {
  return (
    <label className="block text-sm text-[#9eb0a6]">
      {label}
      <input
        type="number"
        step={step}
        min={0}
        className="mt-1 w-full border border-[#24302a] bg-transparent px-3 py-2"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
