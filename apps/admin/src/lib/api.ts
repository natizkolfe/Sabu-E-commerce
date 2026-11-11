export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

export function mediaUrl(pathOrKey: string) {
  if (!pathOrKey) return "";
  if (pathOrKey.startsWith("http")) return pathOrKey;
  if (pathOrKey.startsWith("/media/") || pathOrKey.startsWith("/studio/")) {
    return `${API_URL}${pathOrKey}`;
  }
  return `${API_URL}/media/file?key=${encodeURIComponent(pathOrKey)}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    let message = `Request failed (${status})`;
    if (typeof body === "object" && body && "message" in body) {
      const m = (body as { message: unknown }).message;
      if (typeof m === "string") message = m;
      else if (Array.isArray(m)) message = m.join(", ");
    }
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export type DeliveryAdminDetail = {
  id: string;
  deliveryNumber: string;
  status: string;
  orderId: string;
  orderNumber: string;
  address: string;
  recipientName: string;
  recipientPhone: string;
  distanceKm: number | null;
  etaMinutes: number | null;
  packageCount: number;
  warehouseName: string;
  lng: number | null;
  lat: number | null;
  deliveryInstructions?: string | null;
  landmarkName?: string | null;
  locationType?: string | null;
  googleMapsUrl?: string | null;
  serviceType?: string;
  serviceTypeCode?: string | null;
  preferredContactChannel?: string | null;
  assignedDriver?: {
    id: string;
    name: string | null;
    phone: string | null;
    code: string | null;
    assignmentStatus: string | null;
  } | null;
  items: Array<{ name: string; sku: string | null; quantity: number }>;
  assignments?: Array<{
    id: string;
    status: string;
    driverName: string;
    driverCode: string;
    driverPhone?: string | null;
    offeredAt: string;
    respondedAt: string | null;
    expiresAt: string | null;
    assignedByName?: string | null;
  }>;
  offers?: Array<{
    id: string;
    status: string;
    driverName: string;
    driverCode: string;
    offeredAt: string;
    respondedAt: string | null;
    expiresAt: string | null;
  }>;
};

export const adminApi = {
  requestOtp(phone: string, fullName?: string) {
    return request<{ ok: boolean; expiresAt: string; devCode?: string }>(
      "/auth/otp/request",
      {
        method: "POST",
        body: JSON.stringify({
          phone,
          fullName,
          clientType: "admin_web",
          purpose: "login",
        }),
      },
    );
  },

  verifyOtp(phone: string, code: string) {
    return request<{
      accessToken: string;
      refreshToken: string;
      user: {
        id: string;
        fullName: string;
        permissions: string[];
        roles: string[];
      };
    }>("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code, clientType: "admin_web" }),
    });
  },

  listOrders(
    token: string,
    params?: {
      status?: string;
      paymentStatus?: string;
      q?: string;
      requiresManualContact?: boolean;
    },
  ) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.paymentStatus) qs.set("paymentStatus", params.paymentStatus);
    if (params?.q) qs.set("q", params.q);
    if (params?.requiresManualContact) qs.set("requiresManualContact", "1");
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<
      Array<{
        id: string;
        orderNumber: string;
        status: string;
        paymentStatus: string;
        fulfillmentType: string;
        grandTotal: number;
        currency: string;
        recipientName: string | null;
        recipientPhone: string | null;
        address: string | null;
        preferredContactChannel: string | null;
        requiresManualContact: boolean;
        placedAt: string | null;
        isGuest: boolean;
        itemCount: number;
        deliveryId: string | null;
        deliveryStatus: string | null;
      }>
    >(`/sales/admin/orders${suffix}`, { token });
  },

  getOrder(token: string, id: string) {
    return request<{
      id: string;
      orderNumber: string;
      status: string;
      paymentStatus: string;
      approvalStatus?: string;
      qaStatus?: string;
      contactStatus?: string;
      approvalNotes?: string | null;
      qaNotes?: string | null;
      approvedAt?: string | null;
      qaCheckedAt?: string | null;
      contactFollowUpAt?: string | null;
      fulfillmentType: string;
      subtotal: number;
      deliveryFee: number;
      deliveryDistanceKm?: number | null;
      deliveryFeeRate?: number | null;
      deliveryRouteSource?: string | null;
      deliveryPricingSnapshot?: Record<string, unknown> | null;
      grandTotal: number;
      currency: string;
      shipping: {
        name: string | null;
        phone: string | null;
        address: string | null;
        lng: number | null;
        lat: number | null;
        landmarkName?: string | null;
        landmarkPlaceId?: string | null;
        landmarkLng?: number | null;
        landmarkLat?: number | null;
        formattedAddress?: string | null;
        deliveryInstructions?: string | null;
        locationType?: string | null;
        locationSource?: string | null;
        locationConfirmedAt?: string | null;
        googleMapsUrl?: string | null;
      };
      preferredContactChannel: string | null;
      requiresManualContact: boolean;
      estimatedDeliveryAt: string | null;
      customerNote: string | null;
      placedAt: string | null;
      isGuest: boolean;
      guestPhone: string | null;
      items: Array<{
        lineNo: number;
        name: string;
        sku: string | null;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
      }>;
      history: Array<{
        fromStatus: string | null;
        toStatus: string;
        reason: string | null;
        changedAt: string;
      }>;
      payments: Array<{
        intentId: string;
        intentStatus: string;
        amount: number;
        transactionId: string | null;
        transactionStatus: string | null;
        methodCode: string | null;
        providerReference?: string | null;
        rejectionReason?: string | null;
      }>;
      deliveries: Array<{
        id: string;
        deliveryNumber: string;
        status: string;
      }>;
      notifications: Array<{
        id: string;
        eventCode: string;
        channel: string;
        destinationMasked: string;
        status: string;
        messagePreview: string | null;
        lastError: string | null;
        attemptCount: number;
        createdAt: string;
        sentAt: string | null;
        whatsappDeepLink?: string | null;
      }>;
      contactAttempts: Array<{
        id: string;
        channel: string;
        outcome: string;
        notes: string | null;
        attemptedAt: string;
        attemptedByName: string | null;
      }>;
    }>(`/sales/admin/orders/${id}`, { token });
  },

  updateOrderStatus(
    token: string,
    id: string,
    body: { status: string; reason?: string },
  ) {
    return request(`/sales/admin/orders/${id}/status`, {
      method: "PATCH",
      token,
      body: JSON.stringify(body),
    });
  },

  recordContactAttempt(
    token: string,
    id: string,
    body: {
      channel: string;
      outcome: string;
      notes?: string;
      clearManualFlag?: boolean;
    },
  ) {
    return request(`/sales/admin/orders/${id}/contact-attempts`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  resendOrderNotification(
    token: string,
    id: string,
    eventCode = "order.placed",
  ) {
    return request<{
      ok: boolean;
      eventCode: string;
      trackingUrl: string;
      message: string;
    }>(`/sales/admin/orders/${id}/notifications/resend`, {
      method: "POST",
      token,
      body: JSON.stringify({ eventCode }),
    });
  },

  listCategories(token?: string) {
    return request<
      Array<{
        id: string;
        parentId?: string | null;
        slug: string;
        name: string;
        nameAm: string | null;
        path?: string;
        sortOrder?: number;
        isActive?: boolean;
        isFeatured?: boolean;
      }>
    >("/catalog/categories", { token });
  },

  adminCategories(token: string) {
    return request<
      Array<{
        id: string;
        parentId: string | null;
        slug: string;
        name: string;
        nameAm: string | null;
        path: string;
        sortOrder: number;
        isActive: boolean;
        isFeatured: boolean;
        featuredSort: number;
        description: string | null;
        metaTitle: string | null;
        metaDescription: string | null;
        aiStudioEnabled: boolean;
        children?: unknown[];
      }>
    >("/catalog/admin/categories", { token });
  },

  createCategory(
    token: string,
    body: {
      parentId?: string | null;
      slug: string;
      name: string;
      nameAm?: string | null;
      description?: string | null;
      sortOrder?: number;
      isActive?: boolean;
      isFeatured?: boolean;
      featuredSort?: number;
      imageStorageKey?: string | null;
      iconStorageKey?: string | null;
      metaTitle?: string | null;
      metaDescription?: string | null;
      aiStudioEnabled?: boolean;
    },
  ) {
    return request<{ id: string; path: string }>("/catalog/admin/categories", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  updateCategory(
    token: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    return request<{ ok: boolean; path: string }>(
      `/catalog/admin/categories/${id}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify(body),
      },
    );
  },

  getCategoryAttributes(token: string, categoryId: string) {
    return request<
      Array<{
        attributeId: string;
        code: string;
        name: string;
        dataType: string;
        isRequired: boolean;
        sortOrder: number;
      }>
    >(`/catalog/admin/categories/${categoryId}/attributes`, { token });
  },

  setCategoryAttributes(
    token: string,
    categoryId: string,
    sets: Array<{
      attributeId: string;
      isRequired?: boolean;
      sortOrder?: number;
    }>,
  ) {
    return request(`/catalog/admin/categories/${categoryId}/attributes`, {
      method: "POST",
      token,
      body: JSON.stringify({ sets }),
    });
  },

  listAttributes(token: string) {
    return request<
      Array<{
        id: string;
        code: string;
        name: string;
        nameAm?: string | null;
        dataType?: string;
        unit?: string | null;
        isFilterable?: boolean;
        values: Array<{ id: string; code: string; label: string }>;
      }>
    >("/catalog/admin/attributes", { token });
  },

  createAttribute(
    token: string,
    body: {
      code: string;
      name: string;
      nameAm?: string | null;
      dataType?: string;
      unit?: string | null;
      isFilterable?: boolean;
      sortOrder?: number;
    },
  ) {
    return request<{ id: string }>("/catalog/admin/attributes", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  updateAttribute(
    token: string,
    id: string,
    body: {
      name?: string;
      nameAm?: string | null;
      dataType?: string;
      unit?: string | null;
      isFilterable?: boolean;
      sortOrder?: number;
    },
  ) {
    return request(`/catalog/admin/attributes/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(body),
    });
  },

  addAttributeValue(
    token: string,
    attributeId: string,
    body: {
      code: string;
      label: string;
      labelAm?: string | null;
      sortOrder?: number;
    },
  ) {
    return request<{ id: string }>(
      `/catalog/admin/attributes/${attributeId}/values`,
      {
        method: "POST",
        token,
        body: JSON.stringify(body),
      },
    );
  },

  listBrands(token: string) {
    return request<
      Array<{ id: string; slug: string; name: string; isActive: boolean }>
    >("/catalog/admin/brands", { token });
  },

  createBrand(token: string, body: { slug: string; name: string }) {
    return request<{ id: string }>("/catalog/admin/brands", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  setProductCategories(
    token: string,
    productId: string,
    body: { categoryIds: string[]; primaryCategoryId?: string },
  ) {
    return request(`/catalog/admin/products/${productId}/categories`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  uploadMedia(
    token: string,
    body: { data: string; folder?: string; mimeType?: string },
  ) {
    return request<{ storageKey: string; url: string; mime: string }>(
      "/media/upload",
      {
        method: "POST",
        token,
        body: JSON.stringify(body),
      },
    );
  },

  addProductImage(
    token: string,
    productId: string,
    body: {
      storageKey: string;
      altText?: string | null;
      isPrimary?: boolean;
      variantId?: string | null;
      source?: string;
    },
  ) {
    return request<{ id: string; isPrimary: boolean }>(
      `/catalog/admin/products/${productId}/images`,
      {
        method: "POST",
        token,
        body: JSON.stringify(body),
      },
    );
  },

  setPrimaryProductImage(token: string, productId: string, imageId: string) {
    return request(
      `/catalog/admin/products/${productId}/images/${imageId}/primary`,
      { method: "POST", token, body: "{}" },
    );
  },

  deleteProductImage(token: string, productId: string, imageId: string) {
    return request(
      `/catalog/admin/products/${productId}/images/${imageId}/delete`,
      { method: "POST", token, body: "{}" },
    );
  },

  listProducts(
    token: string,
    params?: { q?: string; status?: string; bulk?: boolean },
  ) {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.status) qs.set("status", params.status);
    if (params?.bulk) qs.set("bulk", "1");
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<
      Array<{
        id: string;
        slug: string;
        name: string;
        status: string;
        retailNumber?: string | null;
        bulkPurchasingEnabled: boolean;
        categoryName: string;
        variantCount: number;
      }>
    >(`/catalog/admin/products${suffix}`, { token });
  },

  getProduct(token: string, id: string) {
    return request<{
      id: string;
      slug: string;
      name: string;
      nameAm: string | null;
      description: string | null;
      status: string;
      retailNumber?: string | null;
      categoryId: string;
      categoryName: string;
      brandId?: string | null;
      brandName?: string | null;
      categoryIds?: string[];
      categories?: Array<{ id: string; name: string; isPrimary: boolean }>;
      images?: Array<{
        id: string;
        storageKey: string;
        altText: string | null;
        isPrimary: boolean;
        url: string;
        source?: string;
      }>;
      bulkPurchasingEnabled: boolean;
      returnsAllowed?: boolean;
      returnWindowDays?: number | null;
      returnConditions?: string | null;
      returnInstructions?: string | null;
      returnPolicyDescription?: string | null;
      returnPolicyEffectiveAt?: string | null;
      variants: Array<{
        id: string;
        sku: string;
        name: string | null;
        options: Record<string, unknown>;
        retailPrice: number | null;
        wholesaleQty10: number | null;
        isActive: boolean;
        minOrderQtyWholesale: number;
        priceTiers: Array<{
          listCode: string;
          minQty: number;
          unitPrice: number;
          compareAtPrice: number | null;
        }>;
      }>;
    }>(`/catalog/admin/products/${id}`, { token });
  },

  createProduct(
    token: string,
    body: {
      categoryId: string;
      categoryIds?: string[];
      brandId?: string;
      slug: string;
      name: string;
      nameAm?: string;
      description?: string;
      status?: string;
      bulkPurchasingEnabled?: boolean;
    },
  ) {
    return request<{ id: string; retailNumber?: string }>(
      "/catalog/admin/products",
      {
        method: "POST",
        token,
        body: JSON.stringify(body),
      },
    );
  },

  updateProduct(
    token: string,
    id: string,
    body: {
      name?: string;
      nameAm?: string;
      description?: string;
      status?: string;
      categoryId?: string;
      categoryIds?: string[];
      brandId?: string | null;
      bulkPurchasingEnabled?: boolean;
      returnsAllowed?: boolean;
      returnWindowDays?: number | null;
      returnConditions?: string | null;
      returnInstructions?: string | null;
      returnPolicyDescription?: string | null;
    },
  ) {
    return request(`/catalog/admin/products/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(body),
    });
  },

  createVariant(
    token: string,
    productId: string,
    body: {
      sku?: string;
      variantName?: string;
      options?: Record<string, unknown>;
    },
  ) {
    return request<{ id: string; sku?: string; retailNumber?: string }>(
      `/catalog/admin/products/${productId}/variants`,
      {
        method: "POST",
        token,
        body: JSON.stringify(body),
      },
    );
  },

  updateVariant(
    token: string,
    variantId: string,
    body: {
      variantName?: string;
      options?: Record<string, unknown>;
      isActive?: boolean;
    },
  ) {
    return request(`/catalog/admin/variants/${variantId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(body),
    });
  },

  setTier(
    token: string,
    body: {
      listCode: "RETAIL-ETB" | "WHOLESALE-ETB";
      variantId: string;
      minQty: number;
      unitPrice: number;
      compareAtPrice?: number;
    },
  ) {
    return request("/pricing/admin/tiers", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  pendingVerifications(token: string) {
    return request<
      Array<{
        transactionId: string;
        methodCode: string;
        methodName: string;
        merchantReference: string;
        amount: number;
        currency: string;
        customerReference: string | null;
        providerReference: string | null;
        telebirrTxnId: string | null;
        receiptKey: string | null;
        orderNumber: string;
        orderId: string;
        bankName: string | null;
        customerName: string | null;
        phone: string | null;
        subtotal: number;
        deliveryFee: number;
        grandTotal: number;
        duplicateFlag: boolean;
        items: Array<{ name: string; quantity: number; lineTotal: number }>;
        submittedAt: string;
      }>
    >("/payments/verifications/pending", { token });
  },

  approvePayment(token: string, id: string) {
    return request(`/payments/transactions/${id}/approve`, {
      method: "POST",
      token,
    });
  },

  rejectPayment(token: string, id: string, reason: string) {
    return request(`/payments/transactions/${id}/reject`, {
      method: "POST",
      token,
      body: JSON.stringify({ reason }),
    });
  },

  requestPaymentClarification(token: string, id: string, notes: string) {
    return request(`/payments/transactions/${id}/clarification`, {
      method: "POST",
      token,
      body: JSON.stringify({ notes }),
    });
  },

  flagPaymentDuplicate(token: string, id: string, notes?: string) {
    return request(`/payments/transactions/${id}/flag-duplicate`, {
      method: "POST",
      token,
      body: JSON.stringify({ notes }),
    });
  },

  paymentVerificationLogs(token: string, id: string) {
    return request<
      Array<{
        id: string;
        action: string;
        notes: string | null;
        actorName: string | null;
        createdAt: string;
      }>
    >(`/payments/transactions/${id}/verification-logs`, { token });
  },

  getTelebirrSettings(token: string) {
    return request<{
      displayName: string;
      merchantAccount: string;
      instructions: string;
      helpText: string | null;
      txnFormatRegex: string;
      isActive: boolean;
    }>("/payments/admin/telebirr/settings", { token });
  },

  updateTelebirrSettings(
    token: string,
    body: {
      displayName?: string;
      merchantAccount?: string;
      instructions?: string;
      helpText?: string | null;
      txnFormatRegex?: string;
      isActive?: boolean;
    },
  ) {
    return request("/payments/admin/telebirr/settings", {
      method: "PUT",
      token,
      body: JSON.stringify(body),
    });
  },

  getDispatchSettings(token: string) {
    return request<{
      offerTtlMinutes: number;
      defaultSpeedKmh: number;
      feePerKm: number;
      minFee: number;
      maxFee: number | null;
      freeOverAmount: number | null;
      originLng: number;
      originLat: number;
      originName: string;
      originAddress: string;
      standardEnabled: boolean;
      expressEnabled: boolean;
      expressConfigured: boolean;
      standardBaseFare: number;
      expressBaseFare: number;
      expressFeePerKm: number | null;
      expressSurcharge: number;
      peakSurcharge: number;
      holidaySurcharge: number;
      standardEtaBufferMinutes: number;
      expressEtaBufferMinutes: number;
      expressSpeedKmh: number | null;
      promoDiscountAmount: number;
      promoDiscountPercent: number;
      promoLabel: string | null;
      etaDisclaimer: string;
    }>("/delivery/admin/settings", { token });
  },

  updateDispatchSettings(
    token: string,
    body: Partial<{
      offerTtlMinutes: number;
      defaultSpeedKmh: number;
      feePerKm: number;
      minFee: number;
      maxFee: number | null;
      freeOverAmount: number | null;
      originLng: number;
      originLat: number;
      standardEnabled: boolean;
      expressEnabled: boolean;
      standardBaseFare: number;
      expressBaseFare: number;
      expressFeePerKm: number | null;
      expressSurcharge: number;
      peakSurcharge: number;
      holidaySurcharge: number;
      standardEtaBufferMinutes: number;
      expressEtaBufferMinutes: number;
      expressSpeedKmh: number | null;
      promoDiscountAmount: number;
      promoDiscountPercent: number;
      promoLabel: string | null;
      etaDisclaimer: string;
    }>,
  ) {
    return request("/delivery/admin/settings", {
      method: "PUT",
      token,
      body: JSON.stringify(body),
    });
  },

  studioModels(token: string) {
    return request<
      Array<{
        id: string;
        code: string;
        displayName: string;
        ageGroup: string;
      }>
    >("/studio/models", { token });
  },

  studioPending(
    token: string,
    opts?: {
      productId?: string;
      stagedOnly?: boolean;
      jobType?: "try_on" | "product_transform";
    },
  ) {
    const params = new URLSearchParams();
    if (opts?.productId) params.set("productId", opts.productId);
    if (opts?.stagedOnly) params.set("stagedOnly", "1");
    if (opts?.jobType) params.set("jobType", opts.jobType);
    const qs = params.toString() ? `?${params}` : "";
    return request<
      Array<{
        id: string;
        storageKey: string;
        productId?: string | null;
        productName: string;
        productSlug?: string | null;
        staged?: boolean;
        reviewStatus?: string;
        jobType?: string;
        transformPreset?: string | null;
        sourceImageKey?: string;
        sourceUrl?: string | null;
        previewUrl?: string;
        resultUrl?: string;
        modelName?: string | null;
        provider?: string;
      }>
    >(`/studio/reviews/pending${qs}`, { token });
  },

  studioLibrary(token: string) {
    return request<
      Array<{
        id: string;
        storageKey: string;
        productId?: string | null;
        productName: string;
        staged?: boolean;
        reviewStatus?: string;
        jobType?: string;
        transformPreset?: string | null;
        sourceImageKey?: string;
        sourceUrl?: string | null;
        previewUrl?: string;
        resultUrl?: string;
        provider?: string;
        demoSeed?: boolean;
        label?: string | null;
        createdAt?: string;
      }>
    >("/studio/library", { token });
  },

  studioSaveToLibrary(token: string, id: string) {
    return request<{
      ok: boolean;
      savedToLibrary?: boolean;
      needsProductAssign?: boolean;
    }>(`/studio/images/${id}/save`, {
      method: "POST",
      token,
      body: JSON.stringify({}),
    });
  },

  studioTransformPresets(token: string) {
    return request<
      Array<{ code: string; label: string; description: string }>
    >("/studio/transform-presets", { token });
  },

  studioGenerate(
    token: string,
    body: {
      productId?: string;
      modelId?: string;
      variantId?: string;
      sourceImageKey?: string;
      jobType?: "try_on" | "product_transform";
      transformPreset?:
        | "studio_packshot"
        | "ghost_mannequin"
        | "background_cleanup"
        | "white_background_ecommerce";
      /** Optional cutout. Default false = white canvas only. */
      removeBackground?: boolean;
    },
  ) {
    return request<{
      jobId: string;
      status: string;
      jobType: string;
      provider?: string;
      removeBackground?: boolean;
      staged?: boolean;
    }>("/studio/generate", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  studioAttach(
    token: string,
    id: string,
    body: {
      productId: string;
      setPrimary?: boolean;
      includeOriginal?: boolean;
    },
  ) {
    return request<{
      ok: boolean;
      productId: string;
      catalogImageId: string;
      originalImageId?: string | null;
    }>(`/studio/images/${id}/attach`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  studioApprove(token: string, id: string) {
    return request<{
      ok: boolean;
      reviewStatus: string;
      catalogImageId?: string | null;
      needsProductAssign?: boolean;
    }>(`/studio/images/${id}/approve`, {
      method: "POST",
      token,
      body: JSON.stringify({ publish: true }),
    });
  },

  studioReject(token: string, id: string) {
    return request(`/studio/images/${id}/reject`, {
      method: "POST",
      token,
      body: JSON.stringify({}),
    });
  },

  deliveryQueue(token: string) {
    return request<
      Array<{
        orderId: string;
        orderNumber: string;
        orderStatus: string;
        paymentStatus: string;
        grandTotal: number;
        recipientName: string | null;
        recipientPhone: string | null;
        address: string | null;
        lng: number | null;
        lat: number | null;
        placedAt: string | null;
        itemCount: number;
        deliveryId: string | null;
        deliveryNumber: string | null;
        deliveryStatus: string | null;
        distanceKm?: number | null;
      }>
    >("/delivery/admin/queue", { token });
  },

  deliveryDrivers(token: string, all = false) {
    return request<
      Array<{
        id: string;
        code: string;
        name: string;
        phone: string | null;
        availability: string;
        status?: string;
        employmentType?: string;
        zoneName: string | null;
        licenseExpiry?: string;
        activeDeliveries: number;
      }>
    >(`/delivery/admin/drivers${all ? "?all=1" : ""}`, { token });
  },

  deliveryZones(token: string) {
    return request<Array<{ id: string; name: string }>>(
      "/delivery/admin/zones",
      { token },
    );
  },

  createDriver(
    token: string,
    body: {
      fullName: string;
      phone: string;
      licenseNumber: string;
      licenseExpiry: string;
      employmentType?: "employee" | "contractor";
      homeZoneId?: string;
      availability?: "offline" | "available" | "on_break";
      activate?: boolean;
    },
  ) {
    return request<{
      id: string;
      code: string;
      name: string;
      phone: string;
    }>("/delivery/admin/drivers", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  updateDriver(
    token: string,
    id: string,
    body: {
      availability?: string;
      status?: string;
      homeZoneId?: string;
    },
  ) {
    return request(`/delivery/admin/drivers/${id}`, {
      method: "PUT",
      token,
      body: JSON.stringify(body),
    });
  },

  createDelivery(token: string, orderId: string) {
    return request<DeliveryAdminDetail>(
      `/delivery/admin/orders/${orderId}/create`,
      {
        method: "POST",
        token,
      },
    );
  },

  getDelivery(token: string, id: string) {
    return request<DeliveryAdminDetail>(
      `/delivery/admin/deliveries/${id}`,
      { token },
    );
  },

  assignDriver(token: string, deliveryId: string, driverId: string) {
    return request<{
      assignmentId: string;
      reassigned: boolean;
      driverPhone: string | null;
      driverName: string | null;
      deliveryStatus: string;
      dashboardUrl: string;
      customerNotified: boolean;
      qrIssued: boolean;
    }>(`/delivery/admin/deliveries/${deliveryId}/assign`, {
      method: "POST",
      token,
      body: JSON.stringify({ driverId }),
    });
  },

  /** @deprecated Use assignDriver */
  offerDelivery(token: string, deliveryId: string, driverId: string) {
    return this.assignDriver(token, deliveryId, driverId);
  },

  reissueVerification(token: string, deliveryId: string) {
    return request<{
      qrToken: string;
      pin: string;
      expiresAt: string;
    }>(`/delivery/admin/deliveries/${deliveryId}/reissue-verification`, {
      method: "POST",
      token,
    });
  },

  analyticsOverview(token: string, days = 30) {
    return request<{
      periodDays: number;
      gmv: number;
      orderCount: number;
      deliveryFees: number;
      averageOrderValue: number;
      commissionRevenue: number;
      vendorsTotal: number;
      vendorsActive: number;
      unpaidOrders: number;
      pendingPaymentVerifications: number;
      specialOrdersTotal: number;
      specialOrdersSubmitted: number;
      dailyTrend: Array<{ day: string; orderCount: number; gmv: number }>;
    }>(`/analytics/admin/overview?days=${days}`, { token });
  },

  analyticsDashboard(
    token: string,
    params?: Record<string, string | number | undefined | null>,
  ) {
    const qs = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") qs.set(k, String(v));
      }
    }
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{
      kpis: {
        totalOrders: number;
        newOrders: number;
        pendingPaymentVerification: number;
        pendingAdminApproval: number;
        pendingQaReview: number;
        customerContactRequired: number;
        confirmedOrders: number;
        readyForDriverAssignment: number;
        outForDelivery: number;
        completedOrders: number;
        cancelledOrders: number;
        confirmedRevenue: number;
      };
      attention: {
        pendingPaymentVerification: { count: number; overdue: number };
        pendingAdminApproval: { count: number; overdue: number };
        pendingQaReview: { count: number; overdue: number };
        customerContactRequired: { count: number; overdue: number };
        readyForDriverAssignment: { count: number; overdue: number };
      };
      alerts: Array<{
        id: string;
        type: string;
        severity: string;
        title: string;
        body: string | null;
        orderId: string | null;
        createdAt: string;
      }>;
      charts: {
        ordersByStatus: Array<{ status: string; count: number }>;
        dailySales: Array<{
          day: string;
          orderCount: number;
          gmv: number;
          paidGmv: number;
        }>;
        revenueSplit: { productRevenue: number; deliveryFees: number };
        qaRates: { passed: number; failed: number };
        revenueByCategory: Array<{ category: string; revenue: number }>;
        commissionRevenue: number;
        vendorsTotal: number;
        vendorsActive: number;
        specialOrdersTotal: number;
        specialOrdersSubmitted: number;
      };
      orders: {
        items: Array<{
          id: string;
          orderNumber: string;
          customerName: string | null;
          phone: string | null;
          placedAt: string | null;
          itemCount: number;
          productTotal: number;
          deliveryFee: number;
          totalAmount: number;
          telebirrTxnId: string | null;
          paymentStatus: string;
          approvalStatus: string;
          qaStatus: string;
          orderStatus: string;
          deliveryStatus: string | null;
          contactStatus: string;
          assignedDriver: string | null;
          orderType: string;
          fulfillmentType: string;
          requiresManualContact: boolean;
          pendingTransactionId: string | null;
        }>;
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    }>(`/analytics/admin/dashboard${suffix}`, { token });
  },

  approveOrder(token: string, orderId: string, notes?: string) {
    return request(`/sales/admin/orders/${orderId}/approve`, {
      method: "POST",
      token,
      body: JSON.stringify({ notes }),
    });
  },

  rejectOrderApproval(token: string, orderId: string, notes?: string) {
    return request(`/sales/admin/orders/${orderId}/reject-approval`, {
      method: "POST",
      token,
      body: JSON.stringify({ notes }),
    });
  },

  qaOrder(
    token: string,
    orderId: string,
    body: {
      result: "passed" | "failed";
      notes?: string;
      checkedQtyOk?: boolean;
      variantsOk?: boolean;
      packagingOk?: boolean;
    },
  ) {
    return request(`/sales/admin/orders/${orderId}/qa`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  openContactCase(
    token: string,
    orderId: string,
    body: {
      reasonCode: string;
      title?: string;
      details?: string;
      priority?: string;
      followUpAt?: string;
    },
  ) {
    return request(`/sales/admin/orders/${orderId}/contact-cases`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  resolveContactCase(
    token: string,
    orderId: string,
    body?: { caseId?: string; notes?: string; closeAll?: boolean },
  ) {
    return request(`/sales/admin/orders/${orderId}/contact-cases/resolve`, {
      method: "POST",
      token,
      body: JSON.stringify(body ?? { closeAll: true }),
    });
  },

  listVendors(token: string, params?: { status?: string; q?: string }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.q) qs.set("q", params.q);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<
      Array<{
        id: string;
        vendorCode: string;
        businessName: string;
        displayName: string;
        phone: string | null;
        email: string | null;
        status: string;
        commissionRatePct: number | null;
        productCount: number;
        createdAt: string;
      }>
    >(`/marketplace/admin/vendors${suffix}`, { token });
  },

  createVendor(
    token: string,
    body: {
      businessName: string;
      displayName?: string;
      phone?: string;
      email?: string;
      commissionRatePct?: number;
    },
  ) {
    return request(`/marketplace/admin/vendors`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  updateVendor(
    token: string,
    id: string,
    body: {
      status?: string;
      displayName?: string;
      commissionRatePct?: number | null;
      notes?: string;
    },
  ) {
    return request(`/marketplace/admin/vendors/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(body),
    });
  },

  listCommissions(token: string) {
    return request<
      Array<{
        id: string;
        orderNumber: string;
        vendorName: string;
        grossAmount: number;
        ratePct: number;
        commissionAmount: number;
        status: string;
        entryType: string;
        createdAt: string;
      }>
    >("/marketplace/admin/commissions", { token });
  },

  commissionRule(token: string) {
    return request<{ ratePct: number; code: string; appliesTo: string }>(
      "/marketplace/admin/commission-rule",
      { token },
    );
  },

  listSpecialOrders(token: string, status?: string) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<
      Array<{
        id: string;
        requestNumber: string;
        productName: string;
        status: string;
        quantity: number;
        guestName: string;
        guestPhone: string | null;
        sourcingRegion: string;
        sourcingRegionName: string;
        imageCount: number;
        createdAt: string;
      }>
    >(`/procurement/admin/special-orders${qs}`, { token });
  },

  listPartners(token: string) {
    return request<
      Array<{
        id: string;
        code: string;
        name: string;
        countryCode: string;
        city: string | null;
        contactName: string | null;
        whatsapp: string | null;
        email: string | null;
        isActive: boolean;
        portalEnabled: boolean;
      }>
    >("/procurement/admin/partners", { token });
  },

  assignSpecialOrderPartner(
    token: string,
    requestId: string,
    supplierId: string,
  ) {
    return request(`/procurement/admin/special-orders/${requestId}/assign`, {
      method: "POST",
      token,
      body: JSON.stringify({ supplierId }),
    });
  },

  listReceipts(token: string) {
    return request<
      Array<{
        id: string;
        receiptNumber: string;
        orderId: string;
        orderNumber: string;
        orderType: string;
        specialOrderRequestId?: string | null;
        specialOrderNumber?: string | null;
        customerName: string;
        customerPhone: string | null;
        paymentMethodCode: string | null;
        paymentStatus: string;
        subtotal: number;
        deliveryFee: number;
        taxTotal: number;
        discountTotal: number;
        grandTotal: number;
        currency: string;
        createdAt: string;
      }>
    >("/finance/admin/receipts", { token });
  },

  getReceipt(token: string, idOrNumber: string) {
    return request<{
      id: string;
      receiptNumber: string;
      orderId: string;
      orderNumber: string;
      orderType: string;
      specialOrderRequestId?: string | null;
      specialOrderNumber?: string | null;
      productName?: string | null;
      customerName: string;
      customerPhone: string | null;
      paymentMethodCode: string | null;
      paymentStatus: string;
      subtotal: number;
      deliveryFee: number;
      taxTotal: number;
      discountTotal: number;
      grandTotal: number;
      currency: string;
      qrPayload?: string | null;
      lineItems: Array<{
        name: string;
        qty: number;
        unitPrice: number;
        lineTotal: number;
      }>;
      createdAt: string;
    }>(`/finance/admin/receipts/${encodeURIComponent(idOrNumber)}`, { token });
  },
};
