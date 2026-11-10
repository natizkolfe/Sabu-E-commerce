import type { AuthTokens, AuthUser } from "./api";

const ACCESS_KEY = "sabu.accessToken";
const REFRESH_KEY = "sabu.refreshToken";
const USER_KEY = "sabu.user";

export function loadSession(): {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
} {
  if (typeof window === "undefined") {
    return { accessToken: null, refreshToken: null, user: null };
  }
  const userRaw = localStorage.getItem(USER_KEY);
  return {
    accessToken: localStorage.getItem(ACCESS_KEY),
    refreshToken: localStorage.getItem(REFRESH_KEY),
    user: userRaw ? (JSON.parse(userRaw) as AuthUser) : null,
  };
}

export function saveSession(tokens: AuthTokens) {
  localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(tokens.user));
}

export function clearSession() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}
