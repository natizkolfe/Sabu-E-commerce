const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/v1";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    let message = `Request failed (${status})`;
    if (typeof body === "object" && body && "message" in body) {
      const m = (body as { message: unknown }).message;
      if (typeof m === "string") message = m;
      else if (Array.isArray(m)) message = m.join(", ");
    }
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string; guestToken?: string } = {},
): Promise<T> {
  const { token, guestToken, headers, ...rest } = options;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(guestToken ? { "X-Guest-Token": guestToken } : {}),
      ...headers,
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}

export type AuthUser = {
  id: string;
  userType: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  roles: string[];
  permissions: string[];
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
  user: AuthUser;
};

export type CartView = {
  id: string;
  currency: string;
  itemCount: number;
  subtotal: number;
  items: Array<{
    id: string;
    variantId: string;
    quantity: number;
    sku: string;
    productName: string;
    productSlug: string;
    variantName: string | null;
    unitPrice: number | null;
    compareAtPrice: number | null;
    lineTotal: number | null;
    currency: string;
    available: number | null;
    bulkEnabled?: boolean;
    returnsAllowed?: boolean;
    returnWindowDays?: number | null;
    returnPolicyLabel?: string | null;
    returnPolicyDescription?: string | null;
  }>;
};

export type ContactChannel =
  | "whatsapp"
  | "telegram"
  | "viber"
  | "phone"
  | "sms";

export type CheckoutResult = {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus?: string;
  subtotal?: number;
  deliveryFee?: number;
  grandTotal: number;
  currency?: string;
  paymentIntentId: string | null;
  paymentMethodCode?: string;
  paymentMethodDisplayName?: string | null;
  preferredContactChannel?: ContactChannel | string | null;
  requiresManualContact?: boolean;
  recipientName?: string | null;
  recipientPhone?: string | null;
  addressText?: string | null;
  fulfillmentType?: string;
  estimatedDeliveryAt?: string | null;
  trackingUrl?: string | null;
  trackToken: string | null;
  items?: Array<{
    name: string;
    quantity: number;
    unitPrice?: number;
    lineTotal: number;
  }>;
  confirmationMessage?: string;
  whatsappDeepLink?: string | null;
  replayed: boolean;
};

export type CheckoutBody = {
  recipientName: string;
  recipientPhone: string;
  addressText: string;
  lng: number;
  lat: number;
  landmarkName?: string;
  landmarkPlaceId?: string;
  landmarkLng?: number;
  landmarkLat?: number;
  formattedAddress?: string;
  deliveryInstructions?: string;
  locationType?: "exact" | "landmark_nearby";
  locationSource?: "gps" | "search" | "manual_pin" | "admin" | "assisted";
  locationConfirmed?: boolean;
  paymentMethodId: string;
  telebirrTxnId?: string;
  amountAcknowledged?: boolean;
  preferredContactChannel: ContactChannel;
  contactConsent?: boolean;
  fulfillmentType?: "local_delivery" | "store_pickup";
  deliveryServiceType?: "standard" | "express";
  priceListCode?: "RETAIL-ETB" | "WHOLESALE-ETB";
  customerNote?: string;
  idempotencyKey?: string;
  asGuest?: boolean;
  firstName?: string;
  lastName?: string;
};

export const api = {
  requestOtp(phone: string, fullName?: string) {
    return request<{ ok: boolean; expiresAt: string; devCode?: string }>(
      "/auth/otp/request",
      {
        method: "POST",
        body: JSON.stringify({
          phone,
          fullName,
          clientType: "web",
          purpose: "login",
        }),
      },
    );
  },

  verifyOtp(phone: string, code: string) {
    return request<AuthTokens>("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code, clientType: "web" }),
    });
  },

  refresh(refreshToken: string) {
    return request<AuthTokens>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  },

  me(token: string) {
    return request<AuthUser>("/auth/me", { token });
  },

  logout(token: string) {
    return request<{ ok: boolean }>("/auth/logout", {
      method: "POST",
      token,
    });
  },

  listCategories(opts?: { tree?: boolean }) {
    const qs = opts?.tree ? "?tree=1" : "";
    return request<
      Array<{
        id: string;
        parentId: string | null;
        slug: string;
        name: string;
        nameAm: string | null;
        path: string;
        sortOrder?: number;
        isFeatured?: boolean;
        featuredSort?: number;
        description?: string | null;
        children?: Array<{
          id: string;
          parentId: string | null;
          slug: string;
          name: string;
          nameAm: string | null;
          path: string;
          children?: unknown[];
        }>;
      }>
    >(`/catalog/categories${qs}`);
  },

  listProducts(params?: {
    category?: string;
    q?: string;
    bulk?: boolean;
    minPrice?: number;
    maxPrice?: number;
    brand?: string;
    attribute?: string;
    inStock?: boolean;
    onSale?: boolean;
    newArrivals?: boolean;
    retail?: boolean;
    wholesale?: boolean;
    sort?: string;
    limit?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.q) qs.set("q", params.q);
    if (params?.bulk) qs.set("bulk", "1");
    if (params?.minPrice != null) qs.set("minPrice", String(params.minPrice));
    if (params?.maxPrice != null) qs.set("maxPrice", String(params.maxPrice));
    if (params?.brand) qs.set("brand", params.brand);
    if (params?.attribute) qs.set("attribute", params.attribute);
    if (params?.inStock) qs.set("inStock", "1");
    if (params?.onSale) qs.set("onSale", "1");
    if (params?.newArrivals) qs.set("newArrivals", "1");
    if (params?.retail) qs.set("retail", "1");
    if (params?.wholesale) qs.set("wholesale", "1");
    if (params?.sort) qs.set("sort", params.sort);
    if (params?.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{
      items: Array<{
        id: string;
        slug: string;
        name: string;
        nameAm: string | null;
        description: string | null;
        category: { slug: string; name: string };
        brand: string | null;
        bulkPurchasingEnabled: boolean;
        fromPrice: number | null;
        compareAtPrice: number | null;
        wholesaleFromPrice: number | null;
        currency: string;
        imageKey: string | null;
        imageUrl?: string | null;
        variantCount: number;
        inStock?: boolean;
      }>;
      sort?: string;
    }>(`/catalog/products${suffix}`);
  },

  listFacets(params?: { category?: string }) {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<{
      brands: Array<{ name: string; count: number }>;
      attributes: Array<{
        code: string;
        name: string;
        dataType?: string;
        values: Array<{ code: string; label: string; count: number }>;
      }>;
      category?: string | null;
    }>(`/catalog/facets${suffix}`);
  },

  deliveryQuote(params: {
    lat?: number;
    lng?: number;
    subtotal?: number;
    serviceType?: "standard" | "express";
  }) {
    const qs = new URLSearchParams();
    if (params.lat != null) qs.set("lat", String(params.lat));
    if (params.lng != null) qs.set("lng", String(params.lng));
    if (params.subtotal != null) qs.set("subtotal", String(params.subtotal));
    if (params.serviceType) qs.set("serviceType", params.serviceType);
    return request<{
      pendingAdmin: boolean;
      routeSource: string;
      serviceType?: "standard" | "express";
      distanceKm: number | null;
      feePerKm: number;
      baseFare?: number;
      distanceCharge?: number;
      serviceSurcharge?: number;
      deliveryFee: number | null;
      etaMinutes?: number | null;
      etaWindowText?: string | null;
      etaIsEstimate?: boolean;
      etaDisclaimer?: string;
      minApplied: boolean;
      maxApplied: boolean;
      freeApplied: boolean;
      message?: string;
      services?: Array<{
        code: "standard" | "express";
        name: string;
        enabled: boolean;
        available: boolean;
        unavailableReason: string | null;
      }>;
      origin?: {
        lng: number;
        lat: number;
        name: string;
        address: string;
      };
    }>(`/delivery/quote?${qs}`);
  },

  telebirrSettings() {
    return request<{
      displayName: string;
      merchantAccount: string;
      instructions: string;
      helpText: string | null;
      txnFormatRegex: string;
      isActive: boolean;
    }>("/payments/telebirr/settings");
  },

  getProduct(slug: string) {
    return request<{
      id: string;
      slug: string;
      name: string;
      nameAm: string | null;
      description: string | null;
      specifications: Record<string, unknown>;
      category: { slug: string; name: string };
      brand: string | null;
      bulkPurchasingEnabled: boolean;
      returnsAllowed?: boolean;
      returnWindowDays?: number | null;
      returnConditions?: string | null;
      returnInstructions?: string | null;
      returnPolicyDescription?: string | null;
      returnPolicyLabel?: string | null;
      aiPreviews?: Array<{
        id: string;
        storageKey: string;
        variantId: string | null;
        isAiPreview: true;
        previewUrl: string;
      }>;
      variants: Array<{
        id: string;
        sku: string;
        name: string | null;
        options: Record<string, unknown>;
        price: number | null;
        compareAtPrice: number | null;
        currency: string;
        minOrderQtyWholesale: number;
        priceTiers: Array<{
          listCode: string;
          minQty: number;
          unitPrice: number;
        }>;
      }>;
    }>(`/catalog/products/${encodeURIComponent(slug)}`);
  },

  getCart(token: string) {
    return request<CartView>("/sales/cart", { token });
  },

  addCartItem(
    token: string,
    variantId: string,
    quantity: number,
    replace = false,
  ) {
    return request<CartView>("/sales/cart/items", {
      method: "POST",
      token,
      body: JSON.stringify({ variantId, quantity, replace }),
    });
  },

  updateCartItem(token: string, itemId: string, quantity: number) {
    return request<CartView>(`/sales/cart/items/${itemId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ quantity }),
    });
  },

  removeCartItem(token: string, itemId: string) {
    return request<CartView>(`/sales/cart/items/${itemId}`, {
      method: "DELETE",
      token,
    });
  },

  getGuestCart(guestToken: string) {
    return request<CartView>("/sales/guest/cart", { guestToken });
  },

  addGuestCartItem(
    guestToken: string,
    variantId: string,
    quantity: number,
    replace = false,
  ) {
    return request<CartView>("/sales/guest/cart/items", {
      method: "POST",
      guestToken,
      body: JSON.stringify({ variantId, quantity, replace }),
    });
  },

  updateGuestCartItem(guestToken: string, itemId: string, quantity: number) {
    return request<CartView>(`/sales/guest/cart/items/${itemId}`, {
      method: "PATCH",
      guestToken,
      body: JSON.stringify({ quantity }),
    });
  },

  removeGuestCartItem(guestToken: string, itemId: string) {
    return request<CartView>(`/sales/guest/cart/items/${itemId}`, {
      method: "DELETE",
      guestToken,
    });
  },

  checkoutAuth(token: string, body: CheckoutBody) {
    return request<CheckoutResult>("/sales/checkout/auth", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  checkoutGuest(guestToken: string, body: CheckoutBody) {
    return request<CheckoutResult>("/sales/checkout", {
      method: "POST",
      guestToken,
      body: JSON.stringify({ ...body, asGuest: true }),
    });
  },

  trackOrder(orderNumber: string, token: string, phone?: string) {
    const qs = new URLSearchParams({ orderNumber, token });
    if (phone) qs.set("phone", phone);
    return request<{
      orderId?: string;
      orderNumber: string;
      status: string;
      paymentStatus: string;
      fulfillmentType?: string;
      subtotal?: number;
      deliveryFee?: number;
      grandTotal: number;
      currency: string;
      recipientName?: string | null;
      recipientPhoneMasked?: string | null;
      address?: string | null;
      preferredContactChannel?: string | null;
      requiresManualContact?: boolean;
      estimatedDeliveryAt?: string | null;
      deliveryServiceType?: string | null;
      deliveryEtaMinutes?: number | null;
      deliveryEtaWindowText?: string | null;
      deliveryEtaDisclaimer?: string | null;
      deliveryDistanceKm?: number | null;
      etaIsEstimate?: boolean;
      paymentMethodCode?: string | null;
      paymentMethodDisplayName?: string | null;
      trackingUrl?: string | null;
      placedAt: string | null;
      items: Array<{
        name: string;
        quantity: number;
        unitPrice?: number;
        lineTotal: number;
        returnsAllowed?: boolean | null;
        returnWindowDays?: number | null;
        returnPolicyLabel?: string | null;
        returnPolicyDescription?: string | null;
      }>;
      trackToken?: string;
    }>(`/sales/orders/track?${qs}`);
  },

  recoverTrack(orderNumber: string, phone: string) {
    return request<{
      orderNumber: string;
      status: string;
      paymentStatus: string;
      grandTotal: number;
      currency: string;
      trackToken: string;
      trackingUrl?: string | null;
      items: Array<{ name: string; quantity: number; lineTotal: number }>;
    }>("/sales/orders/track/recover", {
      method: "POST",
      body: JSON.stringify({ orderNumber, phone }),
    });
  },

  trackDelivery(orderNumber: string, token: string) {
    const qs = new URLSearchParams({ orderNumber, token });
    return request<{
      deliveryNumber: string;
      status: string;
      driverName: string | null;
      driverPhone: string | null;
      etaMinutes: number | null;
      verified: boolean;
      qrToken: string | null;
      pin: string | null;
    } | null>(`/delivery/customer/track?${qs}`);
  },

  listPaymentMethods() {
    return request<
      Array<{
        id: string;
        code: string;
        displayName: string;
        channel: string;
        provider: string;
      }>
    >("/payments/methods");
  },

  listBankAccounts() {
    return request<
      Array<{
        id: string;
        bankName: string;
        accountName: string;
        accountNumberMasked: string;
        currency: string;
        branchName: string | null;
        instructions: string | null;
      }>
    >("/payments/bank-accounts");
  },

  initializeChapa(
    paymentIntentId: string,
    body: {
      returnUrl: string;
      customerName?: string;
      customerPhone?: string;
    },
  ) {
    return request<{
      transactionId: string;
      merchantReference: string;
      checkoutUrl: string;
      mode: "mock" | "live";
    }>(`/payments/intents/${paymentIntentId}/chapa/initialize`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  mockCompleteChapa(txRef: string) {
    return request<{ ok: boolean }>("/payments/chapa/mock-complete", {
      method: "POST",
      body: JSON.stringify({ txRef }),
    });
  },

  submitBankTransfer(body: {
    paymentIntentId: string;
    companyBankAccountId: string;
    customerReference?: string;
    receiptStorageKey: string;
  }) {
    return request<{
      transactionId: string;
      status: string;
      message: string;
    }>("/payments/bank-transfer/submit", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  listOrders(token: string) {
    return request<
      Array<{
        id: string;
        orderNumber: string;
        status: string;
        paymentStatus: string;
        grandTotal: number;
        currency: string;
        placedAt: string | null;
      }>
    >("/sales/orders", { token });
  },

  getOrder(token: string, orderId: string) {
    return request<{
      id: string;
      orderNumber: string;
      status: string;
      paymentStatus: string;
      subtotal: number;
      deliveryFee: number;
      grandTotal: number;
      currency: string;
      shipping: {
        name: string | null;
        phone: string | null;
        address: string | null;
      };
      placedAt: string | null;
      items: Array<{
        lineNo: number;
        name: string;
        sku: string | null;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
      }>;
    }>(`/sales/orders/${orderId}`, { token });
  },
};
