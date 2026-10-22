import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authSession, safeNext } from "@/lib/supabase/server";
import { UI_LANGUAGE_KEY, validUiLocale } from "@/lib/i18n";
import { loadUiMessages } from "@/lib/i18n-server";
import AccountForm from "@/components/AccountForm";
export const dynamic = "force-dynamic";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; recovery?: string; error?: string }>;
}) {
  const query = await searchParams;
  const next = safeNext(query.next);
  if ((await authSession()) && query.recovery !== "1") redirect(next);
  const locale = validUiLocale((await cookies()).get(UI_LANGUAGE_KEY)?.value);
  return (
    <AccountForm
      locale={locale}
      messages={await loadUiMessages(locale)}
      next={next}
      recovery={query.recovery === "1"}
      confirmationError={!!query.error}
    />
  );
}
