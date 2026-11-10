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
  replayed: boolean;
};

export type CheckoutBody = {
  recipientName: string;
  recipientPhone: string;
  addressText: string;
  lng: number;
  lat: number;
  paymentMethodId: string;
  preferredContactChannel: ContactChannel;
  contactConsent?: boolean;
  fulfillmentType?: "local_delivery" | "store_pickup";
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

  listCategories() {
    return request<
      Array<{
        id: string;
        parentId: string | null;
        slug: string;
        name: string;
        nameAm: string | null;
        path: string;
      }>
    >("/catalog/categories");
  },

  listProducts(params?: { category?: string; q?: string; bulk?: boolean }) {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.q) qs.set("q", params.q);
    if (params?.bulk) qs.set("bulk", "1");
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
        variantCount: number;
      }>;
    }>(`/catalog/products${suffix}`);
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
      paymentMethodCode?: string | null;
      paymentMethodDisplayName?: string | null;
      trackingUrl?: string | null;
      placedAt: string | null;
      items: Array<{
        name: string;
        quantity: number;
        unitPrice?: number;
        lineTotal: number;
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
