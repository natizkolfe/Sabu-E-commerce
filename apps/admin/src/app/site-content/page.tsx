"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { adminApi, ApiError } from "../../lib/api";
import { loadSession } from "../../lib/session";

type AboutContent = Awaited<ReturnType<typeof adminApi.getAboutContent>>;

export default function SiteContentPage() {
  const [token, setToken] = useState<string | null>(null);
  const [content, setContent] = useState<AboutContent | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setToken(s.accessToken);
    adminApi
      .getAboutContent(s.accessToken)
      .then(setContent)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Load failed"),
      );
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !content) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const cleaned = {
        ...content,
        faqs: content.faqs.filter(
          (f) => f.question.trim() && f.answer.trim(),
        ),
      };
      const next = await adminApi.updateAboutContent(token, cleaned);
      setContent(next);
      setMessage("Saved — storefront About Sabu page updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function updateFaq(index: number, field: "question" | "answer", value: string) {
    if (!content) return;
    const faqs = content.faqs.map((f, i) =>
      i === index ? { ...f, [field]: value } : f,
    );
    setContent({ ...content, faqs });
  }

  function addFaq() {
    if (!content) return;
    setContent({
      ...content,
      faqs: [...content.faqs, { question: "", answer: "" }],
    });
  }

  function removeFaq(index: number) {
    if (!content) return;
    setContent({
      ...content,
      faqs: content.faqs.filter((_, i) => i !== index),
    });
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
    <main className="min-h-screen bg-[#0f1412] px-4 py-10 text-[#eef2ef] sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/?modules=1" className="text-sm text-[#8aa897]">
          ← Admin
        </Link>
        <h1 className="mt-2 text-3xl tracking-tight">About Sabu & contact</h1>
        <p className="mt-1 text-sm text-[#9eb0a6]">
          Customer help page content — phone, social links, and FAQs. Keeps
          checkout clean; customers open About Sabu when they have questions.
          Use placeholder social URLs until you have the real pages.
        </p>

        {!content ? (
          <p className="mt-8 text-sm text-[#8aa897]">
            {error ?? "Loading…"}
          </p>
        ) : (
          <form onSubmit={onSave} className="mt-8 space-y-5">
            <label className="block text-sm">
              <span className="text-[#8aa897]">Headline</span>
              <input
                required
                value={content.headline}
                onChange={(e) =>
                  setContent({ ...content, headline: e.target.value })
                }
                className="mt-1 w-full bg-[#17201c] px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[#8aa897]">Intro</span>
              <textarea
                required
                rows={3}
                value={content.intro}
                onChange={(e) =>
                  setContent({ ...content, intro: e.target.value })
                }
                className="mt-1 w-full bg-[#17201c] px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[#8aa897]">Contact note</span>
              <textarea
                rows={2}
                value={content.contactNote}
                onChange={(e) =>
                  setContent({ ...content, contactNote: e.target.value })
                }
                className="mt-1 w-full bg-[#17201c] px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[#8aa897]">Phone (E.164)</span>
              <input
                required
                value={content.phone}
                onChange={(e) =>
                  setContent({ ...content, phone: e.target.value })
                }
                placeholder="+251911129726"
                className="mt-1 w-full bg-[#17201c] px-3 py-2"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["whatsappUrl", "WhatsApp URL"],
                  ["instagramUrl", "Instagram URL"],
                  ["tiktokUrl", "TikTok URL"],
                  ["facebookUrl", "Facebook URL"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-sm">
                  <span className="text-[#8aa897]">{label}</span>
                  <input
                    required
                    value={content[key]}
                    onChange={(e) =>
                      setContent({ ...content, [key]: e.target.value })
                    }
                    className="mt-1 w-full bg-[#17201c] px-3 py-2 text-xs"
                  />
                </label>
              ))}
            </div>

            <div className="border-t border-[#24302a] pt-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg">FAQs</h2>
                <button
                  type="button"
                  onClick={addFaq}
                  className="border border-[#24302a] px-3 py-1.5 text-xs"
                >
                  Add question
                </button>
              </div>
              <ul className="mt-4 space-y-4">
                {content.faqs.map((faq, i) => (
                  <li
                    key={i}
                    className="space-y-2 border border-[#24302a] p-3"
                  >
                    <input
                      value={faq.question}
                      onChange={(e) => updateFaq(i, "question", e.target.value)}
                      placeholder="Question"
                      className="w-full bg-[#17201c] px-3 py-2 text-sm"
                    />
                    <textarea
                      rows={3}
                      value={faq.answer}
                      onChange={(e) => updateFaq(i, "answer", e.target.value)}
                      placeholder="Answer"
                      className="w-full bg-[#17201c] px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeFaq(i)}
                      className="text-xs text-red-400"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="bg-[#2f6b4f] px-4 py-2.5 text-sm disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            {message && <p className="text-sm text-[#2f6b4f]">{message}</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
