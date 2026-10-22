export type LocalBookmark = {
  id: string;
  course_id: string;
  source_id: string;
  source_type: string;
  resource_name: string;
  location: Record<string, number>;
  note: string;
  saved_explanation: string;
  concept_tags: string[];
  created_at: string;
};

export type LocalRevisionNote = {
  id: string;
  topic: string;
  summary: string;
  key_points: string[];
  source_refs: { source_id: string; source_type: string; resource_name: string; location: Record<string, number>; quote?: string }[];
  updated_at?: string;
};

type LocalAttempt = { topic: string; correct: boolean; created_at: string };
type LocalReview = { topic: string; last_reviewed: string };
type LocalData = { bookmarks: LocalBookmark[]; notes: LocalRevisionNote[]; attempts: LocalAttempt[]; reviews: LocalReview[] };

const prefix = "learnflow-local-learning-v1:";
const empty = (): LocalData => ({ bookmarks: [], notes: [], attempts: [], reviews: [] });

function read(courseId: string): LocalData {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${prefix}${courseId}`) || "null") as Partial<LocalData> | null;
    return { ...empty(), ...parsed };
  } catch {
    return empty();
  }
}

function write(courseId: string, data: LocalData) {
  try { window.localStorage.setItem(`${prefix}${courseId}`, JSON.stringify(data)); }
  catch { /* Browser storage can be unavailable or full. */ }
}

export function listLocalLearning(courseId: string) { return read(courseId); }

export function saveLocalBookmark(bookmark: Omit<LocalBookmark, "id" | "created_at"> & Partial<Pick<LocalBookmark, "id" | "created_at">>) {
  const data = read(bookmark.course_id);
  const saved: LocalBookmark = { ...bookmark, id: bookmark.id || crypto.randomUUID(), created_at: bookmark.created_at || new Date().toISOString() };
  data.bookmarks = [saved, ...data.bookmarks.filter((row) => row.id !== saved.id)];
  write(bookmark.course_id, data);
  return saved;
}

export function updateLocalBookmark(courseId: string, id: string, changes: Partial<LocalBookmark>) {
  const data = read(courseId);
  data.bookmarks = data.bookmarks.map((row) => row.id === id ? { ...row, ...changes } : row);
  write(courseId, data);
}

export function deleteLocalBookmark(courseId: string, id: string) {
  const data = read(courseId);
  data.bookmarks = data.bookmarks.filter((row) => row.id !== id);
  write(courseId, data);
}

function topicFor(bookmark: LocalBookmark) {
  const tagged = bookmark.concept_tags?.find(Boolean);
  if (tagged) return tagged;
  const text = (bookmark.saved_explanation || bookmark.note || bookmark.resource_name || "Course review").replace(/\.[a-z0-9]{1,5}$/i, "");
  const sentence = text.replace(/\s+/g, " ").split(/[.!?\n]/)[0].trim();
  return sentence.length > 64 ? `${sentence.slice(0, 61).trimEnd()}…` : sentence || "Course review";
}

export function localRevisionQueue(courseId: string) {
  const data = read(courseId);
  const grouped = new Map<string, { incorrect_count: number; correct_count: number; bookmark_count: number; last_reviewed: string | null; sources: LocalBookmark[] }>();
  for (const attempt of data.attempts) {
    const row = grouped.get(attempt.topic) || { incorrect_count: 0, correct_count: 0, bookmark_count: 0, last_reviewed: null, sources: [] };
    if (attempt.correct) row.correct_count++; else row.incorrect_count++;
    row.last_reviewed = attempt.created_at;
    grouped.set(attempt.topic, row);
  }
  for (const bookmark of data.bookmarks) {
    const topic = topicFor(bookmark);
    const row = grouped.get(topic) || { incorrect_count: 0, correct_count: 0, bookmark_count: 0, last_reviewed: null, sources: [] };
    row.bookmark_count++;
    row.sources.push(bookmark);
    grouped.set(topic, row);
  }
  const now = Date.now();
  const reviews = new Map(data.reviews.map((row) => [row.topic.toLowerCase(), row.last_reviewed]));
  const items = [...grouped.entries()].map(([topic, row]) => {
    const reviewed = reviews.get(topic.toLowerCase()) || row.last_reviewed;
    const days = reviewed ? Math.max(0, Math.floor((now - Date.parse(reviewed)) / 86400000)) : 0;
    const priority = row.incorrect_count * 3 + days + row.bookmark_count * 2;
    const reasons = [row.incorrect_count ? `${row.incorrect_count} wrong answers` : "", days ? `last reviewed ${days} days ago` : "", row.bookmark_count ? `${row.bookmark_count} saved bookmark(s)` : ""].filter(Boolean);
    const source = row.sources[0];
    return { topic, priority, reason: reasons.join(", ") || "Saved course concept", incorrect_count: row.incorrect_count, days_since_last_review: days, bookmark_count: row.bookmark_count,
      source: source ? { source_id: source.source_id, source_type: source.source_type, resource_name: source.resource_name, location: source.location } : null };
  }).sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic));
  const weak_topics = [...grouped.entries()].filter(([, row]) => row.incorrect_count > 0 && row.incorrect_count >= row.correct_count)
    .map(([topic, row]) => ({ topic, incorrect_count: row.incorrect_count, correct_count: row.correct_count, accuracy: row.correct_count / Math.max(1, row.correct_count + row.incorrect_count) }));
  return { items, weak_topics };
}

export function markLocalTopicRevised(courseId: string, topic: string) {
  const data = read(courseId);
  data.reviews = [...data.reviews.filter((row) => row.topic.toLowerCase() !== topic.toLowerCase()), { topic, last_reviewed: new Date().toISOString() }];
  write(courseId, data);
}

export function generateLocalRevisionNotes(courseId: string) {
  const data = read(courseId);
  const groups = new Map<string, LocalBookmark[]>();
  for (const bookmark of data.bookmarks) {
    const topic = topicFor(bookmark);
    groups.set(topic, [...(groups.get(topic) || []), bookmark]);
  }
  const notes = [...groups.entries()].map(([topic, bookmarks]) => {
    const firstText = bookmarks.find((row) => row.saved_explanation || row.note);
    const summary = firstText?.saved_explanation || firstText?.note || `Review ${topic} from the saved course locations.`;
    const key_points = summary.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean).slice(0, 4);
    const source_refs = bookmarks.map((row) => ({ source_id: row.source_id, source_type: row.source_type, resource_name: row.resource_name, location: row.location, quote: row.saved_explanation || row.note }));
    return { id: `local-${encodeURIComponent(topic)}`, topic, summary, key_points, source_refs, updated_at: new Date().toISOString() };
  });
  data.notes = notes;
  write(courseId, data);
  return notes;
}

export function saveLocalNote(courseId: string, note: LocalRevisionNote) {
  const data = read(courseId);
  data.notes = [note, ...data.notes.filter((row) => row.id !== note.id)];
  write(courseId, data);
}

export function deleteLocalNote(courseId: string, id: string) {
  const data = read(courseId);
  data.notes = data.notes.filter((row) => row.id !== id);
  write(courseId, data);
}

