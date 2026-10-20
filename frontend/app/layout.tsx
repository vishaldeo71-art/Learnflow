import { cookies } from "next/headers";
import { UI_LANGUAGE_KEY, validUiLocale, uiDirection } from "@/lib/i18n";
import { loadUiMessages } from "@/lib/i18n-server";
import type { Metadata } from "next";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale=validUiLocale((await cookies()).get(UI_LANGUAGE_KEY)?.value);
  const messages=await loadUiMessages(locale);
  return {title:messages["Learnflow | AI Learning Assistant"],description:messages["Ask questions as you go. Practice what you know. Keep every answer grounded in your course."]};
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale=validUiLocale((await cookies()).get(UI_LANGUAGE_KEY)?.value);
  return <html lang={locale} dir={uiDirection(locale)}><body>{children}</body></html>;
}

