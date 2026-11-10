"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { adminApi, ApiError } from "../lib/api";
import { clearSession, loadSession, saveSession, type AdminSession } from "../lib/session";

const nav = [
  { href: "/orders", label: "Orders" },
  { href: "/products", label: "Products & prices" },
  { href: "/drivers", label: "Drivers" },
  { href: "/deliveries", label: "Delivery dispatch" },
  { href: "/payments", label: "Payment verification" },
  { href: "/studio", label: "AI Studio" },
];

export default function AdminHome() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [phone, setPhone] = useState("+2519");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await adminApi.requestOtp(phone, "Admin");
      setDevCode(res.devCode ?? null);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "OTP failed");
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await adminApi.verifyOtp(phone, code);
      const next = {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        user: res.user,
      };
      saveSession(next);
      setSession(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verify failed");
    }
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <div className="mx-auto max-w-md">
          <p className="text-xs tracking-[0.24em] text-[#8aa897] uppercase">
            Sabu Admin
          </p>
          <h1 className="mt-3 text-4xl tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-[#9eb0a6]">
            Staff OTP login. First admin sign-in promotes this phone to
            Ethiopia operations admin (orders, drivers, dispatch, payments).
          </p>
          <p className="mt-3 text-xs text-[#8aa897]">
            © Lulie Tech LLC. All rights reserved.
          </p>
          {step === "phone" ? (
            <form onSubmit={requestOtp} className="mt-8 space-y-4">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border-b border-[#3a4a42] bg-transparent py-3 outline-none"
                placeholder="+2519..."
              />
              <button
                type="submit"
                className="w-full bg-[#2f6b4f] px-4 py-3 text-sm"
              >
                Send OTP
              </button>
            </form>
          ) : (
            <form onSubmit={verify} className="mt-8 space-y-4">
              {devCode && (
                <p className="text-xs text-[#8aa897]">Dev code: {devCode}</p>
              )}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full border-b border-[#3a4a42] bg-transparent py-3 outline-none"
                placeholder="6-digit code"
              />
              <button
                type="submit"
                className="w-full bg-[#2f6b4f] px-4 py-3 text-sm"
              >
                Verify
              </button>
            </form>
          )}
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f1412] text-[#eef2ef]">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.24em] text-[#8aa897] uppercase">
              Operations
            </p>
            <h1 className="mt-3 text-5xl tracking-tight">Sabu Admin</h1>
            <p className="mt-3 text-[#b7c7be]">
              Signed in as {session.user.fullName}
            </p>
            <p className="mt-2 text-xs text-[#8aa897]">
              © Lulie Tech LLC. All rights reserved.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearSession();
              setSession(null);
            }}
            className="text-sm text-[#8aa897] hover:text-white"
          >
            Sign out
          </button>
        </div>
        <ul className="mt-12 grid gap-3 sm:grid-cols-2">
          {nav.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block border border-[#24302a] px-4 py-5 text-[#d5e0da] transition hover:border-[#2f6b4f]"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
