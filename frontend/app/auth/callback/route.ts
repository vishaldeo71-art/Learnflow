import { NextRequest, NextResponse } from "next/server";
import { authClient, safeNext } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const { error } = await (
      await authClient()
    ).auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(
          safeNext(request.nextUrl.searchParams.get("next")),
          request.nextUrl.origin,
        ),
      );
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", request.nextUrl.origin),
  );
}
