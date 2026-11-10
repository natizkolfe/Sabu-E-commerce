"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, ApiError, type AuthUser } from "../lib/api";
import { clearSession, loadSession, saveSession } from "../lib/session";

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  ready: boolean;
  requestOtp: (phone: string, fullName?: string) => Promise<{ devCode?: string }>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = loadSession();
    setUser(session.user);
    setAccessToken(session.accessToken);
    setRefreshToken(session.refreshToken);
    setReady(true);

    if (!session.accessToken) return;

    api
      .me(session.accessToken)
      .then((me) => setUser(me))
      .catch(async () => {
        if (!session.refreshToken) {
          clearSession();
          setUser(null);
          setAccessToken(null);
          return;
        }
        try {
          const tokens = await api.refresh(session.refreshToken);
          saveSession(tokens);
          setUser(tokens.user);
          setAccessToken(tokens.accessToken);
          setRefreshToken(tokens.refreshToken);
        } catch {
          clearSession();
          setUser(null);
          setAccessToken(null);
          setRefreshToken(null);
        }
      });
  }, []);

  const requestOtp = useCallback(async (phone: string, fullName?: string) => {
    const res = await api.requestOtp(phone, fullName);
    return { devCode: res.devCode };
  }, []);

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    const tokens = await api.verifyOtp(phone, code);
    saveSession(tokens);
    setUser(tokens.user);
    setAccessToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);
  }, []);

  const logout = useCallback(async () => {
    try {
      if (accessToken) await api.logout(accessToken);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    } finally {
      clearSession();
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
    }
  }, [accessToken]);

  const value = useMemo(
    () => ({
      user,
      accessToken,
      ready,
      requestOtp,
      verifyOtp,
      logout,
    }),
    [user, accessToken, ready, requestOtp, verifyOtp, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
