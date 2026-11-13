"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../../lib/api";
import {
  ETHIOPIAN_PHONE_ERROR,
  isValidEthiopianMobile,
  normalizeEthiopianPhone,
} from "../../lib/phone";

type RegionCode = "AE-DXB" | "CN" | "US";
type ContactChannel = "whatsapp" | "telegram" | "phone";

const REGIONS: Array<{ code: RegionCode; label: string; detail: string }> = [
  {
    code: "AE-DXB",
    label: "Dubai",
    detail: "United Arab Emirates",
  },
  {
    code: "CN",
    label: "China",
    detail: "Mainland China suppliers",
  },
  {
    code: "US",
    label: "United States",
    detail: "USA",
  },
];

const MAX_IMAGE_BYTES = 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png"];

type UploadedImage = {
  storageKey: string;
  mime: string;
  size: number;
  previewUrl: string;
  name: string;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
}

export default function SpecialOrderRequestPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [preferredChannel, setPreferredChannel] =
    useState<ContactChannel>("whatsapp");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [regionCode, setRegionCode] = useState<RegionCode | "">("");
  const [quantity, setQuantity] = useState(1);
  const [productUrl, setProductUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const phoneValid = isValidEthiopianMobile(phoneLocal);
  const phoneE164 = normalizeEthiopianPhone(phoneLocal) ?? "";

  const canSubmit = useMemo(() => {
    return (
      firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      phoneValid &&
      productName.trim().length > 0 &&
      description.trim().length > 0 &&
      regionCode !== "" &&
      quantity >= 1 &&
      Boolean(image) &&
      !uploading &&
      !submitting
    );
  }, [
    firstName,
    lastName,
    phoneValid,
    productName,
    description,
    regionCode,
    quantity,
    image,
    uploading,
    submitting,
  ]);

  async function onImageSelected(file: File | null) {
    setImageError(null);
    if (!file) return;

    const mime = file.type.toLowerCase();
    if (!ACCEPTED_TYPES.includes(mime) && !/\.(jpe?g|png)$/i.test(file.name)) {
      setImageError("Please upload an image in JPG, JPEG, or PNG format.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(
        "Your image must be less than 1 MB. Please select a smaller image.",
      );
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const uploaded = await api.uploadSpecialOrderImage({
        data: dataUrl,
        mimeType: mime || "image/jpeg",
      });
      if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
      setImage({
        storageKey: uploaded.storageKey,
        mime: uploaded.mime,
        size: uploaded.size,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
      });
    } catch (err) {
      setImageError(
        err instanceof ApiError
          ? err.message
          : "Could not upload image. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  function clearImage() {
    if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    setImage(null);
    setImageError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setShowErrors(true);
    setFormError(null);
    if (!canSubmit || !regionCode || !image) return;

    setSubmitting(true);
    try {
      const result = await api.createSpecialOrder({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phoneE164,
        sourcingRegionCode: regionCode,
        productName: productName.trim(),
        description: description.trim(),
        quantity,
        preferredContactChannel: preferredChannel,
        productUrl: productUrl.trim() || undefined,
        customerInstructions: instructions.trim() || undefined,
        imageStorageKeys: [image.storageKey],
        imageMimeTypes: [image.mime],
        imageSizes: [image.size],
      });

      try {
        sessionStorage.setItem(
          `sabu_sor_${result.requestNumber}`,
          JSON.stringify(result),
        );
      } catch {
        /* ignore */
      }

      router.push(
        `/special-orders/confirmation?requestNumber=${encodeURIComponent(result.requestNumber)}`,
      );
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : "Could not submit your special order request.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7faf8_0%,#eef5f0_55%,#f7faf8_100%)] px-6 py-16 text-sabu-ink">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/#special-orders"
          className="text-sm text-sabu-moss transition hover:text-sabu-leaf"
        >
          ← Back
        </Link>

        <p className="mt-8 text-xs tracking-[0.24em] text-sabu-moss uppercase">
          Special order
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-syne)] text-3xl tracking-tight sm:text-4xl">
          Request a product from abroad
        </h1>
        <p className="mt-3 text-sabu-moss">
          Can&apos;t find what you&apos;re looking for? Request a special order
          from Dubai, China, or the USA, and our team will help you find it. No
          account or payment is required to submit this request.
        </p>

        <form onSubmit={onSubmit} className="mt-10 space-y-10">
          <section className="space-y-5">
            <h2 className="font-[family-name:var(--font-syne)] text-xl">
              Customer information
            </h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-sabu-moss">First name</span>
                <input
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
                />
                {showErrors && !firstName.trim() && (
                  <p className="mt-1 text-xs text-red-700">
                    First name is required.
                  </p>
                )}
              </label>
              <label className="block text-sm">
                <span className="text-sabu-moss">Last name</span>
                <input
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
                />
                {showErrors && !lastName.trim() && (
                  <p className="mt-1 text-xs text-red-700">
                    Last name is required.
                  </p>
                )}
              </label>
            </div>

            <div>
              <p className="text-sm text-sabu-moss">Phone number</p>
              <div
                className={`mt-1 flex items-stretch border-b ${
                  showErrors && !phoneValid
                    ? "border-red-500"
                    : "border-sabu-moss/40"
                }`}
              >
                <span className="flex items-center bg-sabu-mist/20 px-3 py-3 text-sm font-medium">
                  +251
                </span>
                <input
                  required
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={phoneLocal}
                  onChange={(e) =>
                    setPhoneLocal(e.target.value.replace(/\D/g, "").slice(0, 9))
                  }
                  placeholder="911123456"
                  className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                  aria-label="Ethiopian mobile number without country code"
                />
              </div>
              {showErrors && !phoneValid && (
                <p className="mt-1 text-xs text-red-700">
                  {ETHIOPIAN_PHONE_ERROR}
                </p>
              )}
              {phoneValid && (
                <p className="mt-1 text-xs text-sabu-moss">
                  Will be saved as {phoneE164}
                </p>
              )}
            </div>

            <fieldset>
              <legend className="text-sm text-sabu-moss">
                Preferred communication method
              </legend>
              <div className="mt-3 flex flex-wrap gap-3">
                {(
                  [
                    ["whatsapp", "WhatsApp"],
                    ["telegram", "Telegram"],
                    ["phone", "Regular phone call"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`cursor-pointer border px-4 py-2 text-sm transition ${
                      preferredChannel === value
                        ? "border-sabu-leaf bg-sabu-leaf/10 text-sabu-ink"
                        : "border-sabu-moss/30 text-sabu-moss hover:border-sabu-leaf"
                    }`}
                  >
                    <input
                      type="radio"
                      name="preferredChannel"
                      value={value}
                      checked={preferredChannel === value}
                      onChange={() => setPreferredChannel(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          <section className="space-y-5">
            <h2 className="font-[family-name:var(--font-syne)] text-xl">
              Product request
            </h2>

            <label className="block text-sm">
              <span className="text-sabu-moss">Product name</span>
              <input
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
              />
              {showErrors && !productName.trim() && (
                <p className="mt-1 text-xs text-red-700">
                  Product name is required.
                </p>
              )}
            </label>

            <label className="block text-sm">
              <span className="text-sabu-moss">Product description</span>
              <textarea
                required
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the product you are looking for, including the brand, size, color, model, or any other important details."
                className="mt-1 w-full resize-y border border-sabu-moss/30 bg-transparent px-3 py-3 outline-none focus:border-sabu-leaf"
              />
              {showErrors && !description.trim() && (
                <p className="mt-1 text-xs text-red-700">
                  Product description is required.
                </p>
              )}
            </label>

            <fieldset>
              <legend className="text-sm text-sabu-moss">
                Country of purchase
              </legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {REGIONS.map((region) => (
                  <button
                    key={region.code}
                    type="button"
                    onClick={() => setRegionCode(region.code)}
                    className={`border px-4 py-4 text-left transition ${
                      regionCode === region.code
                        ? "border-sabu-leaf bg-sabu-leaf/10"
                        : "border-sabu-moss/30 hover:border-sabu-leaf"
                    }`}
                  >
                    <p className="font-medium">{region.label}</p>
                    <p className="mt-1 text-xs text-sabu-moss">{region.detail}</p>
                  </button>
                ))}
              </div>
              {showErrors && !regionCode && (
                <p className="mt-2 text-xs text-red-700">
                  Please select Dubai, China, or the United States.
                </p>
              )}
            </fieldset>

            <label className="block text-sm">
              <span className="text-sabu-moss">Quantity</span>
              <input
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                }
                className="mt-1 w-28 border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
              />
            </label>

            <div>
              <p className="text-sm text-sabu-moss">Product image (required)</p>
              <p className="mt-1 text-xs text-sabu-moss/80">
                JPG, JPEG, or PNG · less than 1 MB
              </p>
              {!image ? (
                <label className="mt-3 flex cursor-pointer flex-col items-start gap-2 border border-dashed border-sabu-moss/40 px-4 py-6 transition hover:border-sabu-leaf">
                  <span className="text-sm font-medium text-sabu-leaf">
                    {uploading ? "Uploading…" : "Choose image"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) =>
                      onImageSelected(e.target.files?.[0] ?? null)
                    }
                  />
                </label>
              ) : (
                <div className="mt-3 flex flex-wrap items-start gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.previewUrl}
                    alt="Product reference"
                    className="h-32 w-32 object-cover"
                  />
                  <div className="space-y-2 text-sm">
                    <p className="text-sabu-moss">{image.name}</p>
                    <p className="text-xs text-sabu-moss/80">
                      {(image.size / 1024).toFixed(0)} KB
                    </p>
                    <div className="flex gap-3">
                      <label className="cursor-pointer text-sabu-leaf underline">
                        Replace
                        <input
                          type="file"
                          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                          className="sr-only"
                          disabled={uploading}
                          onChange={(e) =>
                            onImageSelected(e.target.files?.[0] ?? null)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={clearImage}
                        className="text-red-700 underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {(imageError || (showErrors && !image)) && (
                <p className="mt-2 text-xs text-red-700">
                  {imageError ?? "Please upload a product reference image."}
                </p>
              )}
            </div>

            <label className="block text-sm">
              <span className="text-sabu-moss">
                Additional instructions{" "}
                <span className="text-sabu-moss/60">(optional)</span>
              </span>
              <textarea
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="mt-1 w-full resize-y border border-sabu-moss/30 bg-transparent px-3 py-3 outline-none focus:border-sabu-leaf"
              />
            </label>

            <label className="block text-sm">
              <span className="text-sabu-moss">
                Product website link{" "}
                <span className="text-sabu-moss/60">(optional)</span>
              </span>
              <input
                type="url"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://"
                className="mt-1 w-full border-b border-sabu-moss/40 bg-transparent py-3 outline-none focus:border-sabu-leaf"
              />
            </label>
          </section>

          {formError && <p className="text-sm text-red-700">{formError}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-sabu-leaf px-6 py-4 text-sm font-medium text-white transition enabled:hover:bg-sabu-ink disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            {submitting ? "Submitting…" : "Submit Special Order Request"}
          </button>
          <p className="text-xs text-sabu-moss">
            No payment is required now. We will contact you with price,
            shipping, and delivery estimates before you decide to proceed.
          </p>
        </form>
      </div>
    </main>
  );
}
