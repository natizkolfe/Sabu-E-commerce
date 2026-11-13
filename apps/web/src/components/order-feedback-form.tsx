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
  hint,
  value,
  onChange,
  required,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  required?: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-sabu-ink">
        {label}
        {!required && (
          <span className="font-normal text-sabu-moss"> — optional</span>
        )}
      </p>
      {hint && <p className="mt-0.5 text-xs text-sabu-moss">{hint}</p>}
      <div className="mt-2 flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-10 w-10 text-xl transition ${
              n <= value
                ? "text-sabu-leaf"
                : "text-sabu-moss/35 hover:text-sabu-moss"
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
  orderStatus,
}: {
  orderNumber: string;
  trackToken: string;
  initialFeedback?: Feedback | null;
  /** When not delivered yet, delivery rating is hidden. */
  orderStatus?: string | null;
}) {
  const showDelivery =
    orderStatus === "delivered" ||
    orderStatus === "completed" ||
    orderStatus === "ready_for_delivery";

  const [feedback, setFeedback] = useState<Feedback | null>(
    initialFeedback ?? null,
  );
  const [overall, setOverall] = useState(0);
  const [website, setWebsite] = useState(0);
  const [interactive, setInteractive] = useState(0);
  const [delivery, setDelivery] = useState(0);
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
      setError("Please tap the stars for your overall experience.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitOrderFeedback({
        orderNumber,
        token: trackToken,
        overallRating: overall,
        // Reuse service_rating = website experience, product_rating = interactive
        serviceRating: website || undefined,
        productRating: interactive || undefined,
        deliveryRating: showDelivery && delivery ? delivery : undefined,
        comment: comment.trim() || undefined,
        wouldRecommend: wouldRecommend ?? undefined,
      });
      setFeedback(res.feedback);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "We could not save your feedback. Please try again.",
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
          Thank you — we appreciate you
        </h2>
        <p className="mt-2 text-sm text-sabu-moss">
          Your rating helps Sabu Online Shopping feel better for the next
          customer.
        </p>
        <div className="mt-4 space-y-2 text-sm text-sabu-moss">
          <p>
            Overall experience:{" "}
            <StarsReadOnly value={feedback.overallRating} />
          </p>
          {feedback.serviceRating != null && (
            <p>
              Website experience:{" "}
              <StarsReadOnly value={feedback.serviceRating} />
            </p>
          )}
          {feedback.productRating != null && (
            <p>
              Interactive / easy to use:{" "}
              <StarsReadOnly value={feedback.productRating} />
            </p>
          )}
          {feedback.deliveryRating != null && (
            <p>
              Delivery: <StarsReadOnly value={feedback.deliveryRating} />
            </p>
          )}
          {feedback.wouldRecommend != null && (
            <p>
              Would recommend Sabu: {feedback.wouldRecommend ? "Yes" : "No"}
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
        How was shopping with Sabu?
      </h2>
      <p className="mt-2 text-sm text-sabu-moss">
        A quick rating helps us make the website clearer and friendlier. You can
        skip anything marked optional.
      </p>
      {!showDelivery && (
        <p className="mt-2 text-xs text-sabu-moss/80">
          Delivery rating will be available later — once your order is on the
          way or delivered.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <StarRow
          label="Overall experience"
          hint="How did placing this order feel overall?"
          value={overall}
          onChange={setOverall}
          required
        />
        <StarRow
          label="Website experience"
          hint="Was the site clear, fast, and easy to understand?"
          value={website}
          onChange={setWebsite}
        />
        <StarRow
          label="Interactive"
          hint="Was browsing, cart, and checkout smooth to use?"
          value={interactive}
          onChange={setInteractive}
        />
        {showDelivery && (
          <StarRow
            label="Delivery"
            hint="How was receiving your order?"
            value={delivery}
            onChange={setDelivery}
          />
        )}

        <fieldset>
          <legend className="text-sm font-medium text-sabu-ink">
            Would you recommend Sabu?
            <span className="font-normal text-sabu-moss"> — optional</span>
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
                className={`border px-4 py-2 text-sm transition ${
                  wouldRecommend === value
                    ? "border-sabu-leaf bg-sabu-leaf/10 text-sabu-ink"
                    : "border-sabu-moss/30 text-sabu-moss hover:border-sabu-leaf"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block text-sm font-medium text-sabu-ink">
          Give us a comment
          <span className="font-normal text-sabu-moss"> — optional</span>
          <textarea
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            placeholder="Tell us what you liked, or how we can make Sabu more customer-friendly…"
            className="mt-2 w-full resize-y border border-sabu-moss/30 bg-transparent px-3 py-3 text-sm font-normal text-sabu-ink outline-none focus:border-sabu-leaf"
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
