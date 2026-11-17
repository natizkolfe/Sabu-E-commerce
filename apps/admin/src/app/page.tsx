"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, ApiError } from "../lib/api";
import {
  clearSession,
  loadSession,
  saveSession,
  type AdminSession,
} from "../lib/session";

const nav = [
  { href: "/analytics", label: "Dashboard & Analytics" },
  { href: "/orders", label: "Orders" },
  { href: "/feedback", label: "Customer feedback" },
  { href: "/products", label: "Products & prices" },
  { href: "/categories", label: "Categories" },
  { href: "/attributes", label: "Attributes" },
  { href: "/vendors", label: "Vendors" },
  { href: "/commissions", label: "Vendor report & payouts" },
  { href: "/special-orders", label: "Special Orders" },
  { href: "/receipts", label: "Receipts" },
  { href: "/partners", label: "Partners" },
  { href: "/drivers", label: "Drivers" },
  { href: "/deliveries", label: "Delivery dispatch" },
  { href: "/delivery-settings", label: "Delivery pricing" },
  { href: "/site-content", label: "About Sabu & contact" },
  { href: "/payments", label: "Payment verification" },
  { href: "/studio", label: "Enhance photos" },
  { href: "/studio/try-on", label: "Try-on (optional)" },
];

/** Known staff phones shown on OTP login (tap to fill). */
const STAFF_PHONES = [
  {
    phone: "+14045101204",
    name: "Natnael",
    role: "Developer",
  },
  {
    phone: "+251911129726",
    name: "Henok Lule",
    role: "Owner / Admin",
  },
  {
    phone: "+251911419193",
    name: "Mulu Seifu",
    role: "Co-owner / Admin",
  },
] as const;

function normalizePhoneDigits(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function matchStaffPhone(value: string) {
  const n = normalizePhoneDigits(value);
  return STAFF_PHONES.find(
    (s) =>
      normalizePhoneDigits(s.phone) === n ||
      normalizePhoneDigits(s.phone).endsWith(n.replace(/^\+/, "")) ||
      n.endsWith(normalizePhoneDigits(s.phone).replace(/^\+/, "")),
  );
}

export default function AdminHome() {
  const router = useRouter();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [ready, setReady] = useState(false);
  const [showModules, setShowModules] = useState(false);
  const [phone, setPhone] = useState("+2519");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [otpHint, setOtpHint] = useState<string | null>(null);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const matchedStaff = matchStaffPhone(phone);

  useEffect(() => {
    const s = loadSession();
    const modules =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("modules") === "1";
    setSession(s);
    setShowModules(modules);
    setReady(true);
    if (s && !modules) {
      router.replace("/analytics");
    }
  }, [router]);

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await adminApi.requestOtp(phone, "Admin");
      setDevCode(res.devCode ?? null);
      if (res.devCode) {
        setOtpHint(
          "Temporary on-screen code (until WhatsApp is set up). Enter the digits below.",
        );
      } else if (res.channel === "sms") {
        setOtpHint("Code sent by SMS (Twilio). Check your US phone.");
      } else if (res.channel === "whatsapp") {
        setOtpHint(
          res.deliveryStatus === "sent"
            ? "Code sent on WhatsApp. Check your Ethiopian number."
            : "WhatsApp delivery pending. Open WhatsApp if linked, or check Cloud API / OTP template settings.",
        );
      } else {
        setOtpHint(null);
      }
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
      router.replace("/analytics");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verify failed");
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <p className="text-sm text-[#8aa897]">Loading…</p>
      </main>
    );
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
            Staff OTP login. After sign-in you land on the analytics dashboard.
          </p>
          <p className="mt-3 text-xs text-[#8aa897]">
            © Lulie Tech LLC. All rights reserved.
          </p>
          {step === "phone" ? (
            <form onSubmit={requestOtp} className="mt-8 space-y-4">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[#8aa897]">
                  Staff accounts
                </p>
                <ul className="space-y-2">
                  {STAFF_PHONES.map((staff) => {
                    const selected =
                      normalizePhoneDigits(phone) ===
                      normalizePhoneDigits(staff.phone);
                    return (
                      <li key={staff.phone}>
                        <button
                          type="button"
                          onClick={() => {
                            setPhone(staff.phone);
                            setError(null);
                          }}
                          className={`w-full border px-3 py-3 text-left transition ${
                            selected
                              ? "border-[#2f6b4f] bg-[#2f6b4f]/15"
                              : "border-[#24302a] hover:border-[#2f6b4f]/60"
                          }`}
                        >
                          <span className="block text-sm text-[#eef2ef]">
                            {staff.name}{" "}
                            <span className="text-[#8aa897]">
                              ({staff.role})
                            </span>
                          </span>
                          <span className="mt-0.5 block text-xs text-[#9eb0a6]">
                            {staff.phone}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <label className="block text-xs text-[#8aa897]">
                Phone
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full border-b border-[#3a4a42] bg-transparent py-3 text-sm text-[#eef2ef] outline-none"
                  placeholder="+2519..."
                />
              </label>
              {matchedStaff ? (
                <p className="text-sm text-[#9dcdb4]">
                  Signing in as <strong>{matchedStaff.name}</strong> (
                  {matchedStaff.role})
                </p>
              ) : null}
              <button
                type="submit"
                className="w-full bg-[#2f6b4f] px-4 py-3 text-sm"
              >
                Send OTP
              </button>
            </form>
          ) : (
            <form onSubmit={verify} className="mt-8 space-y-4">
              {matchedStaff ? (
                <p className="text-sm text-[#9dcdb4]">
                  Code for <strong>{matchedStaff.name}</strong> (
                  {matchedStaff.role}) · {phone}
                </p>
              ) : (
                <p className="text-xs text-[#8aa897]">Code sent to {phone}</p>
              )}
              {otpHint && (
                <p className="text-xs text-[#8aa897]">{otpHint}</p>
              )}
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
              <button
                type="button"
                className="w-full text-xs text-[#8aa897]"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setDevCode(null);
                  setOtpHint(null);
                  setError(null);
                }}
              >
                ← Change phone / person
              </button>
            </form>
          )}
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </div>
      </main>
    );
  }

  if (!showModules) {
    return (
      <main className="min-h-screen bg-[#0f1412] px-6 py-16 text-[#eef2ef]">
        <p className="text-sm text-[#8aa897]">Opening analytics dashboard…</p>
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
