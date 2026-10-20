import { cookies } from "next/headers";
import { UI_LANGUAGE_KEY, validUiLocale } from "@/lib/i18n";
import { loadUiMessages } from "@/lib/i18n-server";
import Assistant from "@/components/Assistant";
import { cachedVideoCourse, type Course } from "@/lib/courses";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ video?: string }> }) {
  let courses: Course[] = [];
  // Render saved lessons into the page so a failed browser-side fetch cannot leave
  // a valid saved video disconnected. The service credential stays on the server.
  const apiBase = process.env.BACKEND_API_URL || "http://localhost:8000";
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (process.env.BACKEND_API_KEY) headers.authorization = `Bearer ${process.env.BACKEND_API_KEY}`;
    const response = await fetch(new URL("/api/v1/courses", apiBase), {
      headers, cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.courses)) courses = data.courses;
    }
  } catch {
    // The client retries course loading if this server-side request was interrupted.
  }
  const { video } = await searchParams;
  const preferred = typeof video === "string" && /^[\w-]{11}$/.test(video) ? cachedVideoCourse(courses, video) : undefined;
  const uiLocale = validUiLocale((await cookies()).get(UI_LANGUAGE_KEY)?.value);
  return <Assistant initialCourses={courses} preferredCourseId={preferred?.id} initialUiLocale={uiLocale} initialUiMessages={await loadUiMessages(uiLocale)} />;
}

