import type { Metadata } from "next";
import { Suspense } from "react";
import "@fontsource/syne/500.css";
import "@fontsource/syne/600.css";
import "@fontsource/syne/700.css";
import "@fontsource/syne/800.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import { AuthProvider } from "../context/auth-context";
import { CartProvider } from "../context/cart-context";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sabu Online Shopping | Ethiopia",
  description:
    "Shop fashion, home, beauty, electronics, and more. Retail, wholesale, and Dubai special orders delivered across Ethiopia.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <AuthProvider>
          <CartProvider>
            <Suspense fallback={null}>
              <SiteHeader />
            </Suspense>
            {children}
            <SiteFooter />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
