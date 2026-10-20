import { cookies } from "next/headers";
import { UI_LANGUAGE_KEY, validUiLocale, uiDirection } from "@/lib/i18n";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Learnflow | AI Learning Assistant",
  description: "Watch, pause, ask, understand and practice with course grounded AI.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale=validUiLocale((await cookies()).get(UI_LANGUAGE_KEY)?.value);
  return <html lang={locale} dir={uiDirection(locale)}><body>{children}</body></html>;
}

