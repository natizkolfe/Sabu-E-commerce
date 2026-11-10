"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, type CartView } from "../lib/api";
import { getOrCreateGuestToken } from "../lib/guest";
import { useAuth } from "./auth-context";

type CartContextValue = {
  cart: CartView | null;
  itemCount: number;
  isGuest: boolean;
  guestToken: string | null;
  refresh: () => Promise<void>;
  addItem: (
    variantId: string,
    quantity?: number,
    opts?: { replace?: boolean },
  ) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, ready, user } = useAuth();
  const [cart, setCart] = useState<CartView | null>(null);
  const [guestToken, setGuestToken] = useState<string | null>(null);

  useEffect(() => {
    setGuestToken(getOrCreateGuestToken());
  }, []);

  const refresh = useCallback(async () => {
    if (accessToken && user) {
      const next = await api.getCart(accessToken);
      setCart(next);
      return;
    }
    const token = guestToken ?? getOrCreateGuestToken();
    setGuestToken(token);
    const next = await api.getGuestCart(token);
    setCart(next);
  }, [accessToken, user, guestToken]);

  useEffect(() => {
    if (!ready || !guestToken) return;
    refresh().catch(() => setCart(null));
  }, [ready, user, accessToken, guestToken, refresh]);

  const addItem = useCallback(
    async (
      variantId: string,
      quantity = 1,
      opts?: { replace?: boolean },
    ) => {
      const replace = opts?.replace ?? quantity > 1;
      if (accessToken && user) {
        const next = await api.addCartItem(
          accessToken,
          variantId,
          quantity,
          replace,
        );
        setCart(next);
        return;
      }
      const token = guestToken ?? getOrCreateGuestToken();
      setGuestToken(token);
      const next = await api.addGuestCartItem(
        token,
        variantId,
        quantity,
        replace,
      );
      setCart(next);
    },
    [accessToken, user, guestToken],
  );

  const updateItem = useCallback(
    async (itemId: string, quantity: number) => {
      if (accessToken && user) {
        const next = await api.updateCartItem(accessToken, itemId, quantity);
        setCart(next);
        return;
      }
      if (!guestToken) return;
      const next = await api.updateGuestCartItem(guestToken, itemId, quantity);
      setCart(next);
    },
    [accessToken, user, guestToken],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      if (accessToken && user) {
        const next = await api.removeCartItem(accessToken, itemId);
        setCart(next);
        return;
      }
      if (!guestToken) return;
      const next = await api.removeGuestCartItem(guestToken, itemId);
      setCart(next);
    },
    [accessToken, user, guestToken],
  );

  const value = useMemo(
    () => ({
      cart,
      itemCount: cart?.itemCount ?? 0,
      isGuest: !(accessToken && user),
      guestToken,
      refresh,
      addItem,
      updateItem,
      removeItem,
    }),
    [cart, accessToken, user, guestToken, refresh, addItem, updateItem, removeItem],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
