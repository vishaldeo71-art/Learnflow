export type Course = { id: string; title: string; description?: string; video_url?: string | null };

export function cachedVideoCourse(courses: Course[], videoId: string): Course | undefined {
  return courses.find((course) => course.video_url === `https://www.youtube.com/watch?v=${videoId}` &&
    (course.description?.startsWith("Imported ") || course.description?.startsWith("AI video notes · Gemini")));
}

export function defaultCourse(courses: Course[], preferredId?: string): Course | undefined {
  return courses.find((course) => course.id === preferredId) ||
    courses.find((course) => course.video_url && course.description?.startsWith("Imported ")) ||
    courses.find((course) => course.video_url && course.description?.startsWith("AI video notes · Gemini")) ||
    courses.find((course) => course.id === "00000000-0000-4000-8000-000000000001") || courses[0];
}

export function rememberCourse(id: string) {
  try { window.localStorage.setItem("learnflow-course", id); }
  catch { /* Storage may be disabled; the current lesson still works. */ }
}
