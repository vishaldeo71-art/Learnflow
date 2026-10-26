import { NextRequest } from "next/server";
import { authClient, safeNext } from "@/lib/supabase/server";
import { loginErrorMessage } from "@/lib/auth-errors";
import { accountMode, accountNotice, loginNotice } from "@/lib/auth-notices";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return Response.json({ error: "Invalid request." }, { status: 403 });
  const contentType = request.headers.get("content-type") || "";
  const nativeForm = contentType.startsWith("application/x-www-form-urlencoded") || contentType.startsWith("multipart/form-data");
  let body: Record<string,unknown>;
  try {
    body = nativeForm ? Object.fromEntries(await request.formData()) : await request.json();
    if (!body || typeof body !== "object") throw new Error("Invalid body");
  } catch {
    return Response.json({error:"Invalid request."},{status:400});
  }
  const next = safeNext(body.next);
  // POST/Redirect/GET avoids relying on fetch for Safari's account navigation.
  // Passwords, email addresses and names never enter redirect URLs.
  function reply(data: {next?: string; error?: string; confirmation?: boolean; sent?: boolean}, status=200, notice="failed") {
    if (!nativeForm) return Response.json(data,{status});
    if (!data.error && !data.confirmation && !data.sent)
      return Response.redirect(new URL(body.action === "logout" ? "/login" : body.action === "password" ? "/" : next,request.nextUrl.origin),303);
    const location = new URL("/login",request.nextUrl.origin);
    location.searchParams.set("next",next);
    location.searchParams.set("mode",accountMode(body.action));
    location.searchParams.set("notice",data.confirmation ? "confirmation" : data.sent ? "reset_sent" : notice);
    if (body.action === "password") location.searchParams.set("recovery","1");
    return Response.redirect(location,303);
  }
  const email = typeof body.email === "string" ? body.email.trim().slice(0,254) : "";
  const password = typeof body.password === "string" ? body.password : "";
  try {
    const client = await authClient();
    let error;
    if (body.action === "logout") ({error} = await client.auth.signOut());
    else if (body.action === "signup") {
      if (password.length < 10 || password.length > 128)
        return reply({error:accountNotice("invalid_password")},400,"invalid_password");
      const result = await client.auth.signUp({email,password,options:{
        data:{full_name:typeof body.name === "string" ? body.name.trim().slice(0,100) : ""},
        emailRedirectTo:`${request.nextUrl.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      }});
      error = result.error;
      if (!error) return reply({next,confirmation:!result.data.session});
    } else if (body.action === "reset") {
      ({error} = await client.auth.resetPasswordForEmail(email,{redirectTo:`${request.nextUrl.origin}/auth/callback?next=/login%3Frecovery%3D1`}));
    } else if (body.action === "password") {
      if (password.length < 10 || password.length > 128)
        return reply({error:accountNotice("invalid_password")},400,"invalid_password");
      ({error} = await client.auth.updateUser({password}));
    } else if (body.action === "login") {
      ({error} = await client.auth.signInWithPassword({email,password}));
    } else return reply({error:accountNotice("failed")},400);
    if (error) return reply({error:body.action === "login" ? loginErrorMessage(error) : accountNotice("failed")},400,body.action === "login" ? loginNotice(error.code) : "failed");
    return reply({next,sent:body.action === "reset"});
  } catch {
    return reply({error:accountNotice("unavailable")},503,"unavailable");
  }
}
