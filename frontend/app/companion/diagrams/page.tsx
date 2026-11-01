import { cookies } from "next/headers";
import { UI_LANGUAGE_KEY, validUiLocale } from "@/lib/i18n";
import { loadUiMessages } from "@/lib/i18n-server";
import DiagramPreview from "@/components/DiagramPreview";
export default async function DiagramPage() {
  const locale=validUiLocale((await cookies()).get(UI_LANGUAGE_KEY)?.value);
  return <DiagramPreview locale={locale} messages={await loadUiMessages(locale)}/>;
}
