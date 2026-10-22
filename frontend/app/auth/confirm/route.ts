import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { authClient, safeNext } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  if (token_hash && type && ["signup", "recovery", "email"].includes(type)) {
    const { error } = await (
      await authClient()
    ).auth.verifyOtp({ token_hash, type });
    if (!error)
      return NextResponse.redirect(
        new URL(
          type === "recovery"
            ? "/login?recovery=1"
            : safeNext(request.nextUrl.searchParams.get("next")),
          request.nextUrl.origin,
        ),
      );
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", request.nextUrl.origin),
  );
}
