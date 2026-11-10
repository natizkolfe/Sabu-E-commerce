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

  listProducts(params?: { category?: string; q?: string }) {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.q) qs.set("q", params.q);
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
        fromPrice: number | null;
        compareAtPrice: number | null;
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
      variants: Array<{
        id: string;
        sku: string;
        name: string | null;
        options: Record<string, unknown>;
        price: number | null;
        compareAtPrice: number | null;
        currency: string;
      }>;
    }>(`/catalog/products/${encodeURIComponent(slug)}`);
  },
};
