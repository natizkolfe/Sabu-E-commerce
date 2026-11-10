const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

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
      fulfillmentType: string;
      subtotal: number;
      deliveryFee: number;
      grandTotal: number;
      currency: string;
      shipping: {
        name: string | null;
        phone: string | null;
        address: string | null;
        lng: number | null;
        lat: number | null;
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
        slug: string;
        name: string;
        nameAm: string | null;
      }>
    >("/catalog/categories", { token });
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
      categoryId: string;
      categoryName: string;
      bulkPurchasingEnabled: boolean;
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
      slug: string;
      name: string;
      nameAm?: string;
      description?: string;
      status?: string;
      bulkPurchasingEnabled?: boolean;
    },
  ) {
    return request<{ id: string }>("/catalog/admin/products", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  updateProduct(
    token: string,
    id: string,
    body: {
      name?: string;
      nameAm?: string;
      description?: string;
      status?: string;
      bulkPurchasingEnabled?: boolean;
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
      sku: string;
      variantName?: string;
      options?: Record<string, unknown>;
    },
  ) {
    return request<{ id: string }>(
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
        merchantReference: string;
        amount: number;
        currency: string;
        customerReference: string | null;
        receiptKey: string | null;
        orderNumber: string;
        bankName: string | null;
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

  studioPending(token: string) {
    return request<
      Array<{
        id: string;
        storageKey: string;
        productName: string;
        productSlug: string;
      }>
    >("/studio/reviews/pending", { token });
  },

  studioGenerate(
    token: string,
    body: { productId: string; modelId: string; variantId?: string },
  ) {
    return request("/studio/generate", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  studioApprove(token: string, id: string) {
    return request(`/studio/images/${id}/approve`, {
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
    return request<{
      id: string;
      deliveryNumber: string;
      status: string;
      orderNumber: string;
      address: string;
      recipientName: string;
      recipientPhone: string;
      distanceKm: number | null;
      etaMinutes: number | null;
      packageCount: number;
      warehouseName: string;
      items: Array<{ name: string; sku: string | null; quantity: number }>;
      offers: Array<{
        id: string;
        status: string;
        driverName: string;
        driverCode: string;
        offeredAt: string;
        respondedAt: string | null;
        expiresAt: string | null;
      }>;
    }>(`/delivery/admin/orders/${orderId}/create`, {
      method: "POST",
      token,
    });
  },

  getDelivery(token: string, id: string) {
    return request<{
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
      items: Array<{ name: string; sku: string | null; quantity: number }>;
      offers: Array<{
        id: string;
        status: string;
        driverName: string;
        driverCode: string;
        offeredAt: string;
        respondedAt: string | null;
        expiresAt: string | null;
      }>;
    }>(`/delivery/admin/deliveries/${id}`, { token });
  },

  offerDelivery(token: string, deliveryId: string, driverId: string) {
    return request<{
      assignmentId: string;
      offerToken: string;
      offerLink: string;
      expiresAt: string;
      whatsappPreview: string;
      driverPhone: string | null;
    }>(`/delivery/admin/deliveries/${deliveryId}/offer`, {
      method: "POST",
      token,
      body: JSON.stringify({ driverId }),
    });
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
};
