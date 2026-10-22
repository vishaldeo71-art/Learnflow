import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authSession } from "@/lib/supabase/server";
import { UI_LANGUAGE_KEY, validUiLocale } from "@/lib/i18n";
import { loadUiMessages } from "@/lib/i18n-server";
import AdminPanel from "@/components/AdminPanel";
export const dynamic = "force-dynamic";
export default async function Setup() {
  if (!(await authSession())) redirect("/login?next=/admin/setup");
  const locale = validUiLocale((await cookies()).get(UI_LANGUAGE_KEY)?.value);
  return (
    <AdminPanel locale={locale} messages={await loadUiMessages(locale)} setup />
  );
}
