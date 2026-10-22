import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authSession } from "@/lib/supabase/server";
import { UI_LANGUAGE_KEY, validUiLocale } from "@/lib/i18n";
import { loadUiMessages } from "@/lib/i18n-server";
import AdminPanel from "@/components/AdminPanel";
export const dynamic = "force-dynamic";
export default async function Admin() {
  const session = await authSession();
  if (!session) redirect("/login?next=/admin");
  const response = await fetch(
    new URL(
      "/api/v1/account",
      process.env.BACKEND_API_URL || "http://localhost:8000",
    ),
    {
      headers: {
        authorization: `Bearer ${process.env.BACKEND_API_KEY}`,
        "x-user-token": session.token,
      },
      cache: "no-store",
    },
  );
  if (!response.ok || !(await response.json()).is_admin) redirect("/");
  const locale = validUiLocale((await cookies()).get(UI_LANGUAGE_KEY)?.value);
  return <AdminPanel locale={locale} messages={await loadUiMessages(locale)} />;
}
