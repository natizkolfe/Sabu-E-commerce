import type { Metadata } from "next";
import { Suspense } from "react";
import { Manrope, Syne } from "next/font/google";
import { AuthProvider } from "../context/auth-context";
import { CartProvider } from "../context/cart-context";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sabu Online Shopping — Ethiopia",
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
      <body
        className={`${syne.variable} ${manrope.variable} min-h-screen antialiased`}
      >
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
