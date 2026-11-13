"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

type Feedback = {
  id: string;
  overallRating: number;
  productRating: number | null;
  deliveryRating: number | null;
  serviceRating: number | null;
  comment: string | null;
  wouldRecommend: boolean | null;
  createdAt: string;
};

function StarRow({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  required?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-sabu-moss">
        {label}
        {required ? "" : " (optional)"}
      </p>
      <div className="mt-2 flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-10 w-10 text-lg transition ${
              n <= value ? "text-sabu-leaf" : "text-sabu-moss/35 hover:text-sabu-moss"
            }`}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            aria-checked={n === value}
            role="radio"
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

function StarsReadOnly({ value }: { value: number }) {
  return (
    <span className="tracking-wider text-sabu-leaf" aria-label={`${value} of 5`}>
      {"★".repeat(value)}
      <span className="text-sabu-moss/35">{"★".repeat(5 - value)}</span>
    </span>
  );
}

export function OrderFeedbackForm({
  orderNumber,
  trackToken,
  initialFeedback,
}: {
  orderNumber: string;
  trackToken: string;
  initialFeedback?: Feedback | null;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(
    initialFeedback ?? null,
  );
  const [overall, setOverall] = useState(0);
  const [product, setProduct] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [service, setService] = useState(0);
  const [comment, setComment] = useState("");
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(Boolean(initialFeedback));

  useEffect(() => {
    if (initialFeedback) {
      setFeedback(initialFeedback);
      setLoaded(true);
      return;
    }
    if (!orderNumber || !trackToken) return;
    api
      .getOrderFeedback(orderNumber, trackToken)
      .then((res) => {
        setFeedback(res.feedback);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [orderNumber, trackToken, initialFeedback]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!overall) {
      setError("Please choose an overall star rating.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitOrderFeedback({
        orderNumber,
        token: trackToken,
        overallRating: overall,
        productRating: product || undefined,
        deliveryRating: delivery || undefined,
        serviceRating: service || undefined,
        comment: comment.trim() || undefined,
        wouldRecommend: wouldRecommend ?? undefined,
      });
      setFeedback(res.feedback);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not save your feedback.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <section className="mt-10 border-t border-sabu-mist/50 pt-8">
        <p className="text-sm text-sabu-moss">Loading feedback…</p>
      </section>
    );
  }

  if (feedback) {
    return (
      <section className="mt-10 border-t border-sabu-mist/50 pt-8">
        <p className="text-xs tracking-[0.2em] text-sabu-moss uppercase">
          Your feedback
        </p>
        <h2 className="mt-2 font-[family-name:var(--font-syne)] text-2xl text-sabu-ink">
          Thank you for rating Sabu
        </h2>
        <div className="mt-4 space-y-2 text-sm text-sabu-moss">
          <p>
            Overall: <StarsReadOnly value={feedback.overallRating} />
          </p>
          {feedback.productRating != null && (
            <p>
              Products: <StarsReadOnly value={feedback.productRating} />
            </p>
          )}
          {feedback.deliveryRating != null && (
            <p>
              Delivery: <StarsReadOnly value={feedback.deliveryRating} />
            </p>
          )}
          {feedback.serviceRating != null && (
            <p>
              Service: <StarsReadOnly value={feedback.serviceRating} />
            </p>
          )}
          {feedback.wouldRecommend != null && (
            <p>
              Would recommend: {feedback.wouldRecommend ? "Yes" : "No"}
            </p>
          )}
          {feedback.comment && (
            <p className="mt-3 whitespace-pre-line text-sabu-ink">
              “{feedback.comment}”
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10 border-t border-sabu-mist/50 pt-8">
      <p className="text-xs tracking-[0.2em] text-sabu-moss uppercase">
        Customer feedback
      </p>
      <h2 className="mt-2 font-[family-name:var(--font-syne)] text-2xl text-sabu-ink">
        How was your order experience?
      </h2>
      <p className="mt-2 text-sm text-sabu-moss">
        Rate Sabu Online Shopping — it helps us improve products, delivery, and
        service.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <StarRow
          label="Overall experience"
          value={overall}
          onChange={setOverall}
          required
        />
        <StarRow label="Products" value={product} onChange={setProduct} />
        <StarRow label="Delivery" value={delivery} onChange={setDelivery} />
        <StarRow label="Customer service" value={service} onChange={setService} />

        <fieldset>
          <legend className="text-sm text-sabu-moss">
            Would you recommend Sabu? (optional)
          </legend>
          <div className="mt-2 flex gap-2">
            {(
              [
                [true, "Yes"],
                [false, "No"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setWouldRecommend(value)}
                className={`border px-4 py-2 text-sm ${
                  wouldRecommend === value
                    ? "border-sabu-leaf bg-sabu-leaf/10 text-sabu-ink"
                    : "border-sabu-moss/30 text-sabu-moss"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block text-sm text-sabu-moss">
          Comments (optional)
          <textarea
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            placeholder="Tell us what went well or what we can improve…"
            className="mt-1 w-full resize-y border border-sabu-moss/30 bg-transparent px-3 py-3 text-sabu-ink outline-none focus:border-sabu-leaf"
          />
        </label>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy || !overall}
          className="bg-sabu-leaf px-5 py-3 text-sm text-sabu-cream transition enabled:hover:bg-sabu-forest disabled:opacity-40"
        >
          {busy ? "Sending…" : "Submit feedback"}
        </button>
      </form>
    </section>
  );
}
