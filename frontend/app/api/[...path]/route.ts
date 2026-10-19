import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const apiBase = process.env.BACKEND_API_URL || "http://localhost:8000";
  const upstreamUrl = new URL(`/api/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, apiBase);
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", "application/json");
  const backendKey = process.env.BACKEND_API_KEY;
  if (backendKey) headers.set("authorization", `Bearer ${backendKey}`);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  try {
    const upstream = await fetch(upstreamUrl, { method: request.method, headers, body, cache: "no-store", signal: AbortSignal.timeout(110000) });
    // These endpoints return JSON. Read the response before committing browser
    // headers so interrupted backend streams become a recoverable HTTP error.
    const responseBody = await upstream.text();
    return new Response(responseBody, { status: upstream.status, headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "x-request-id": upstream.headers.get("x-request-id") || "",
      "cache-control": "no-store",
    } });
  } catch (error) {
    console.error("Learnflow backend request failed", { path: path.join("/"), error: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ detail: "The learning service is temporarily unavailable. Please retry in a moment." }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
