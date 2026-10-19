import assert from "node:assert/strict";
import test from "node:test";
import { api, ConnectionError } from "../lib/api.ts";
import { cachedVideoCourse, defaultCourse, rememberCourse } from "../lib/courses.ts";

test("course loading recovers after Safari's Load failed transport error", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) throw new TypeError("Load failed");
    return Response.json({ courses: [{ id: "saved" }] });
  });
  assert.deepEqual(await api("v1/courses"), { courses: [{ id: "saved" }] });
  assert.equal(calls, 2);
});

test("a cached import recovers after an interrupted response body", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) return { text: async () => { throw new TypeError("Load failed"); } };
    return Response.json({ course: { id: "saved" }, cached: true });
  });
  assert.equal((await api("v1/videos/youtube/import", { method: "POST", body: "{}" })).cached, true);
  assert.equal(calls, 2);
});

test("temporary server failures recover, but validation errors are not retried", async (t) => {
  let calls = 0;
  const fetch = t.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? Response.json({ detail: "warming up" }, { status: 503 })
    : Response.json({ courses: [] }));
  assert.deepEqual(await api("v1/courses"), { courses: [] });
  assert.equal(calls, 2);
  fetch.mock.mockImplementation(async () => { calls++; return Response.json({ detail: "Invalid video" }, { status: 422 }); });
  await assert.rejects(api("v1/videos/youtube/import", { method: "POST" }), /Invalid video/);
  assert.equal(calls, 3);
});

test("questions are not automatically replayed after an ambiguous failure", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new TypeError("Failed to fetch"); });
  await assert.rejects(api("v1/learning/ask", { method: "POST", body: "{}" }), ConnectionError);
  assert.equal(calls, 1);
});

test("retries stop with a useful connection message", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new TypeError("Load failed"); });
  await assert.rejects(api("v1/courses"), /Your saved lesson is still available/);
  assert.equal(calls, 3);
});

test("malformed successful responses are not treated as course data", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Error</html>"));
  await assert.rejects(api("v1/courses"), /unreadable response/);
});

test("cached video matching cannot attach a different lesson's sources", () => {
  const courses = [
    { id: "wrong", title: "Other lesson", description: "Imported captions", video_url: "https://www.youtube.com/watch?v=9hE5-98ZeCg" },
    { id: "python", title: "Python", description: "Imported English YouTube captions", video_url: "https://www.youtube.com/watch?v=UrsmFxEIp5k" },
  ];
  assert.equal(cachedVideoCourse(courses, "UrsmFxEIp5k")?.id, "python");
  assert.equal(cachedVideoCourse(courses, "abcdefghijk"), undefined);
  assert.equal(defaultCourse(courses, "python")?.id, "python");
});

test("default lesson prefers prepared video content over an empty course", () => {
  const empty = { id: "empty", title: "https://www.youtube.com/watch?v=UrsmFxEIp5k" };
  const ready = { id: "ready", title: "Python", description: "Imported English YouTube captions", video_url: "https://www.youtube.com/watch?v=UrsmFxEIp5k" };
  assert.equal(defaultCourse([empty, ready])?.id, "ready");
});

test("disabled browser storage does not prevent attaching a lesson", (t) => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { setItem() { throw new Error("Storage disabled"); } } } });
  t.after(() => { delete globalThis.window; });
  assert.doesNotThrow(() => rememberCourse("python"));
});
