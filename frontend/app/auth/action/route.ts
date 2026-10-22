import { NextRequest } from "next/server";
import { authClient, safeNext } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return Response.json({ error: "Invalid request." }, { status: 403 });
  const body = await request.json();
  const client = await authClient();
  const next = safeNext(body.next);
  const email =
    typeof body.email === "string" ? body.email.trim().slice(0, 254) : "";
  const password = typeof body.password === "string" ? body.password : "";
  let error;
  if (body.action === "logout") ({ error } = await client.auth.signOut());
  else if (body.action === "signup") {
    if (password.length < 10 || password.length > 128)
      return Response.json(
        { error: "Use a password with 10 to 128 characters." },
        { status: 400 },
      );
    const result = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name:
            typeof body.name === "string" ? body.name.trim().slice(0, 100) : "",
        },
        emailRedirectTo: `${request.nextUrl.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    error = result.error;
    if (!error)
      return Response.json({ next, confirmation: !result.data.session });
  } else if (body.action === "reset") {
    ({ error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${request.nextUrl.origin}/auth/callback?next=/login%3Frecovery%3D1`,
    }));
  } else if (body.action === "password") {
    if (password.length < 10 || password.length > 128)
      return Response.json(
        { error: "Use a password with 10 to 128 characters." },
        { status: 400 },
      );
    ({ error } = await client.auth.updateUser({ password }));
  } else if (body.action === "login")
    ({ error } = await client.auth.signInWithPassword({ email, password }));
  else return Response.json({ error: "Invalid request." }, { status: 400 });
  if (error)
    return Response.json(
      {
        error:
          body.action === "login"
            ? "Sign-in failed. Check your email, password, and email confirmation."
            : "The account request could not be completed. Please retry later.",
      },
      { status: 400 },
    );
  return Response.json({ next, sent: body.action === "reset" });
}
