"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../../context/auth-context";

export default function AccountPage() {
  const router = useRouter();
  const { user, ready, logout } = useAuth();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) {
    return (
      <main className="min-h-screen bg-sabu-paper pt-28">
        <p className="px-6 text-sabu-moss">Loading account…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f3f7f4_0%,#e8f5ee_100%)] pt-28 pb-16">
      <div className="mx-auto max-w-3xl px-6">
        <p className="text-xs tracking-[0.24em] text-sabu-moss uppercase">
          Account
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-syne)] text-4xl text-sabu-ink">
          {user.fullName}
        </h1>
        <dl className="mt-10 space-y-5 border-t border-sabu-mist/50 pt-8 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-sabu-moss">Phone</dt>
            <dd className="text-sabu-ink">{user.phone ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-sabu-moss">Type</dt>
            <dd className="text-sabu-ink capitalize">{user.userType}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-sabu-moss">Roles</dt>
            <dd className="text-right text-sabu-ink">{user.roles.join(", ")}</dd>
          </div>
        </dl>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/catalog"
            className="bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream hover:bg-sabu-forest"
          >
            Browse catalog
          </Link>
          <button
            type="button"
            onClick={async () => {
              await logout();
              router.push("/");
            }}
            className="border border-sabu-moss px-5 py-3 text-sm text-sabu-moss hover:border-sabu-ink hover:text-sabu-ink"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
