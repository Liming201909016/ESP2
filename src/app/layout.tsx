import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies } from "next/headers";
import { localeCookie, resolveLocale } from "../lib/esp/locale";
import { LocaleProvider } from "./locale-provider";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "ESP | Enterprise Skill Platform",
  description: "Governed enterprise skill discovery and execution.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = resolveLocale((await cookies()).get(localeCookie)?.value);
  return (
    <html lang={locale} className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-full flex flex-col"><LocaleProvider initialLocale={locale}>{children}</LocaleProvider></body>
    </html>
  );
}
