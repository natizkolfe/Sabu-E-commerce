"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../lib/api";
import { useAuth } from "../context/auth-context";

function toE164(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("251")) return `+${digits}`;
  if (digits.startsWith("0")) return `+251${digits.slice(1)}`;
  return `+251${digits}`;
}

export function AuthForm() {
  const router = useRouter();
  const { requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+251");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const e164 = toE164(phone);
      const res = await requestOtp(e164, fullName.trim() || undefined);
      setPhone(e164);
      setDevCode(res.devCode ?? null);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send code");
    } finally {
      setLoading(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verifyOtp(toE164(phone), code.trim());
      router.push("/account");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="font-[family-name:var(--font-syne)] text-4xl tracking-tight text-sabu-ink">
        Sign in
      </h1>
      <p className="mt-3 text-sabu-moss">
        Use your Ethiopian phone number. New numbers create an account
        automatically.
      </p>

      {step === "phone" ? (
        <form onSubmit={onRequest} className="mt-8 space-y-4">
          <label className="block text-sm text-sabu-moss">
            Full name
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Optional for returning users"
              className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent px-0 py-3 text-sabu-ink outline-none focus:border-sabu-leaf"
            />
          </label>
          <label className="block text-sm text-sabu-moss">
            Phone
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+251911234567"
              required
              className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent px-0 py-3 text-sabu-ink outline-none focus:border-sabu-leaf"
            />
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full bg-sabu-leaf px-5 py-3 text-sm font-medium text-sabu-cream transition hover:bg-sabu-forest disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={onVerify} className="mt-8 space-y-4">
          <p className="text-sm text-sabu-moss">
            Code sent to <span className="text-sabu-ink">{phone}</span>
          </p>
          {devCode && (
            <p className="border border-sabu-gold/40 bg-sabu-gold/10 px-3 py-2 text-sm text-sabu-ink">
              Dev OTP: <strong className="tracking-widest">{devCode}</strong>
            </p>
          )}
          <label className="block text-sm text-sabu-moss">
            6-digit code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              required
              className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent px-0 py-3 text-2xl tracking-[0.4em] text-sabu-ink outline-none focus:border-sabu-leaf"
            />
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="mt-4 w-full bg-sabu-leaf px-5 py-3 text-sm font-medium text-sabu-cream transition hover:bg-sabu-forest disabled:opacity-60"
          >
            {loading ? "Verifying…" : "Verify & continue"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setCode("");
              setDevCode(null);
              setError(null);
            }}
            className="w-full py-2 text-sm text-sabu-moss hover:text-sabu-ink"
          >
            Use a different number
          </button>
        </form>
      )}
    </div>
  );
}
