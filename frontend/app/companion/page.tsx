import { cookies } from "next/headers";
import { UI_LANGUAGE_KEY, validUiLocale } from "@/lib/i18n";
import { loadUiMessages } from "@/lib/i18n-server";
import CompanionPlayground from "@/components/CompanionPlayground";
export default async function CompanionPage() {
  const locale = validUiLocale((await cookies()).get(UI_LANGUAGE_KEY)?.value);
  return <CompanionPlayground locale={locale} messages={await loadUiMessages(locale)}/>;
}
