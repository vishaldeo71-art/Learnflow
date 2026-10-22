"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export type EvidenceCitation = {
  label: string; source_type: string; type?: string; source_id?: string; chunk_id?: string;
  seek_seconds: number | null; start_seconds?: number | null; end_seconds?: number | null;
  page?: number | null; slide?: number | null; resource_name?: string | null; quote?: string;
};
type Bookmark = { id: string; course_id: string; source_id: string; source_type: string; resource_name: string; location: Record<string, number>; note: string; saved_explanation: string; concept_tags: string[]; created_at: string };
type RevisionNote = { id: string; topic: string; summary: string; key_points: string[]; source_refs: { source_id: string; source_type: string; resource_name: string; location: Record<string, number>; quote?: string }[] };
type QuizQuestion = { id: string; topic: string; difficulty: number; question: string; options: string[]; citation: EvidenceCitation };
const timeText = (seconds: number) => seconds >= 3600
  ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
  : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export function CitationChip({ citation, onClick }: { citation: EvidenceCitation; onClick(citation: EvidenceCitation): void }) {
  const videoTime = citation.start_seconds ?? citation.seek_seconds ?? null;
  const approximateVideoNotes = citation.source_type === "video" && (
    citation.label.startsWith("AI video notes (approximate)") || citation.resource_name?.startsWith("AI video notes (approximate)")
  );
  const label = citation.source_type === "video" ? videoTime === null ? "▶ Timestamp unavailable"
    : approximateVideoNotes && citation.end_seconds != null ? `▶ ≈ ${timeText(videoTime)}–${timeText(citation.end_seconds)}` : `▶ ${timeText(videoTime)}`
    : citation.source_type === "pdf" ? `📄 Page ${citation.page ?? "—"}`
      : citation.source_type === "ppt" ? `🖥 Slide ${citation.slide ?? "—"}` : citation.label;
  return <button type="button" className="citation" title={approximateVideoNotes ? `${citation.label} · approximate clip range` : citation.resource_name || citation.label} disabled={citation.source_type === "video" && videoTime === null} onClick={() => onClick(citation)}>{label}</button>;
}

export function MediaViewer({ courseId, citation, onClose }: { courseId: string; citation: EvidenceCitation | null; onClose(): void }) {
  const [data, setData] = useState<{ resource_name: string; location: number; passages: { id: string; content: string }[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!citation || citation.source_type === "video") { setData(null); return; }
    const location = citation.source_type === "pdf" ? citation.page : citation.slide;
    if (!citation.source_id || !location) { setError("This source location is not available."); return; }
    setError(""); setData(null);
    const query = new URLSearchParams({ source_type: citation.source_type, page: String(location), slide: String(location) });
    api<typeof data>(`v1/courses/${courseId}/resources/${citation.source_id}/location?${query}`).then(setData).catch((e: Error) => setError(e.message));
  }, [courseId, citation]);
  if (!citation || citation.source_type === "video") return null;
  const where = citation.source_type === "pdf" ? `Page ${citation.page}` : `Slide ${citation.slide}`;
  return <div className="media-viewer" role="dialog" aria-label={`${citation.resource_name} ${where}`}>
    <div className="media-viewer-head"><div><small>COURSE SOURCE</small><strong>{citation.resource_name || data?.resource_name || "Supporting material"}</strong><span>{where}</span></div><button className="button-secondary" onClick={onClose}>Back to video</button></div>
    {error ? <p className="muted">{error}</p> : !data ? <p className="muted">Opening source location…</p> : <div className="media-page" key={`${citation.source_id}-${data.location}`}>
      <div className="media-page-label">{where}</div>{data.passages.map((passage) => {
        const body = passage.content || ""; const quote = citation.quote?.trim(); const index = quote ? body.toLowerCase().indexOf(quote.slice(0, Math.min(90, quote.length)).toLowerCase()) : -1;
        return <p key={passage.id}>{index >= 0 ? <>{body.slice(0, index)}<mark>{body.slice(index, index + Math.min(quote!.length, body.length - index))}</mark>{body.slice(index + Math.min(quote!.length, body.length - index))}</> : body}</p>;
      })}</div>}
  </div>;
}

export function BookmarkButton({ courseId, citation, explanation = "", label = "Save" }: { courseId: string; citation?: EvidenceCitation; explanation?: string; label?: string }) {
  const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  if (!citation?.source_id || !["video", "pdf", "ppt"].includes(citation.source_type)) return null;
  async function save() {
    setBusy(true); setError("");
    const location = citation!.source_type === "video" ? { seconds: citation!.start_seconds ?? citation!.seek_seconds ?? 0 }
      : citation!.source_type === "pdf" ? { page: citation!.page ?? 1 } : { slide: citation!.slide ?? 1 };
    try {
      await api("v1/learning/bookmarks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course_id: courseId, source_id: citation!.source_id, source_type: citation!.source_type, resource_name: citation!.resource_name || citation!.label, location, note: "", saved_explanation: explanation, concept_tags: [] }) });
      setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save bookmark."); }
    finally { setBusy(false); }
  }
  return <span className="bookmark-control"><button type="button" className="save-button" disabled={busy || saved} onClick={() => void save()}>{saved ? "Saved ✓" : busy ? "Saving…" : `☆ ${label}`}</button>{error && <small role="alert">{error}</small>}</span>;
}

export function QuizCard({ courseId, seconds, topic, open, onClose, onCitation }: { courseId: string; seconds: number; topic?: string; open: boolean; onClose(): void; onCitation(citation: EvidenceCitation): void }) {
  const [quizId, setQuizId] = useState(""); const [questions, setQuestions] = useState<QuizQuestion[]>([]); const [index, setIndex] = useState(0); const [choice, setChoice] = useState<number | null>(null); const [result, setResult] = useState<{ correct: boolean; explanation?: string; citation?: EvidenceCitation; next_question?: QuizQuestion } | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [done, setDone] = useState(0);
  useEffect(() => { if (!open || !courseId) return; let active = true; setBusy(true); setError(""); setQuestions([]); setIndex(0); setDone(0); setResult(null); setChoice(null);
    api<{ quiz_id: string; questions: QuizQuestion[] }>("v1/learning/quiz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course_id: courseId, video_time_seconds: Math.floor(seconds), topic: topic || null }) })
      .then((value) => { if (active) { setQuizId(value.quiz_id); setQuestions(value.questions); } }).catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, courseId, topic]);
  if (!open) return null;
  const question = questions[index];
  async function submit() {
    if (!question || choice === null) return; setBusy(true); setError("");
    try { const outcome = await api<typeof result>(`v1/learning/quiz/${quizId}/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course_id: courseId, question_id: question.id, selected_index: choice }) }); setResult(outcome); setDone((n) => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not record this answer."); } finally { setBusy(false); }
  }
  function next() { const adaptive = result?.next_question; if (adaptive) setQuestions((all) => [...all.slice(0, index + 1), adaptive, ...all.slice(index + 1)]); if (index >= questions.length - 1 && !adaptive) { setIndex(questions.length); } else setIndex((n) => n + 1); setChoice(null); setResult(null); }
  return <div className="feature-modal-backdrop"><section className="feature-modal" role="dialog" aria-modal="true" aria-label="Course quiz"><header><div><small>LEARNFLOW PRACTICE</small><h3>Quick quiz {question ? `· ${Math.min(done + 1, 5)} of 5` : ""}</h3></div><button className="icon-button" onClick={onClose} aria-label="Close quiz">×</button></header>
    {busy && <p className="muted">Preparing your source-backed questions…</p>}{error && <p className="feature-error" role="alert">{error}</p>}{!busy && !error && question && <><span className="topic-pill">{question.topic} · Level {question.difficulty}</span><h4>{question.question}</h4><CitationChip citation={question.citation} onClick={onCitation} /><div className="quiz-options">{question.options.map((option, i) => <button key={i} disabled={Boolean(result)} className={choice === i ? "selected" : ""} onClick={() => setChoice(i)}>{String.fromCharCode(65 + i)}. {option}</button>)}</div>{result ? <div className={result.correct ? "quiz-feedback correct" : "quiz-feedback incorrect"}><strong>{result.correct ? "Correct" : "Not quite"}</strong>{result.explanation && <p>{result.explanation}</p>}{result.citation && <CitationChip citation={result.citation} onClick={onCitation} />}<button className="button-primary" onClick={next}>{index >= 4 && !result.next_question ? "Finish quiz" : "Continue"}</button></div> : <button className="button-primary" disabled={choice === null || busy} onClick={() => void submit()}>Check answer</button>}</>}
    {!busy && !error && !question && <div className="quiz-feedback correct"><h4>Practice complete</h4><p>{done} answer{done === 1 ? "" : "s"} recorded. Your weak topics are updated.</p><button className="button-primary" onClick={onClose}>Done</button></div>}
  </section></div>;
}

export function RevisionQueue({ courseId, onQuiz, onCitation, refreshKey = 0 }: { courseId: string; onQuiz(topic: string): void; onCitation(citation: EvidenceCitation): void; refreshKey?: number }) {
  const [items, setItems] = useState<any[]>([]); const [weak, setWeak] = useState<any[]>([]); const [error, setError] = useState("");
  async function refresh() { if (!courseId) return; try { const [queue, progress] = await Promise.all([api<{ items: any[] }>(`v1/learning/revision-queue?course_id=${courseId}`), api<{ weak_topics: any[] }>(`v1/learning/progress?course_id=${courseId}`)]); setItems(queue.items); setWeak(progress.weak_topics); } catch (e) { setError(e instanceof Error ? e.message : "Could not load revision queue."); } }
  useEffect(() => { void refresh(); }, [courseId, refreshKey]);
  async function revised(topic: string) { try { await api("v1/learning/revision-queue/revised", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course_id: courseId, topic }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update revision status."); } }
  return <section className="feature-panel"><div className="card-heading"><div><p className="eyebrow">REVIEW PLAN</p><h3>Revision queue</h3></div></div>{error && <p className="feature-error">{error}</p>}{weak.length > 0 && <div className="weak-topics"><strong>Needs another look</strong>{weak.map((row) => <span key={row.topic}>{row.topic} · {row.incorrect_count} incorrect</span>)}</div>}{items.length ? items.map((item) => <article className="revision-queue-item" key={item.topic}><div><strong>{item.topic}</strong><small>Priority {item.priority} · {item.reason}</small></div><div className="revision-actions">{item.source && <CitationChip citation={{ label: item.source.resource_name, source_type: item.source.source_type, source_id: item.source.source_id, resource_name: item.source.resource_name, seek_seconds: item.source.location.seconds ?? null, start_seconds: item.source.location.seconds, page: item.source.location.page, slide: item.source.location.slide }} onClick={onCitation} />}<button className="button-secondary" onClick={() => onQuiz(item.topic)}>Start quick quiz</button><button className="button-secondary" onClick={() => void revised(item.topic)}>Mark revised</button></div></article>) : <p className="muted">No review items yet. Take a quiz or save a source bookmark to build your queue.</p>}</section>;
}

export function RevisionNotes({ courseId, onCitation }: { courseId: string; onCitation(citation: EvidenceCitation): void }) {
  const [notes, setNotes] = useState<RevisionNote[]>([]); const [bookmarks, setBookmarks] = useState<Bookmark[]>([]); const [search, setSearch] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [editing, setEditing] = useState("");
  async function refresh() { if (!courseId) return; try { const [noteData, bookmarkData] = await Promise.all([api<{ notes: RevisionNote[] }>(`v1/learning/revision-notes?course_id=${courseId}`), api<{ bookmarks: Bookmark[] }>(`v1/learning/bookmarks?course_id=${courseId}`)]); setNotes(noteData.notes); setBookmarks(bookmarkData.bookmarks); } catch (e) { setError(e instanceof Error ? e.message : "Could not load notes."); } }
  useEffect(() => { void refresh(); }, [courseId]);
  const visible = useMemo(() => notes.filter((note) => `${note.topic} ${note.summary} ${note.key_points.join(" ")}`.toLowerCase().includes(search.toLowerCase())), [notes, search]);
  async function generate() { setBusy(true); setError(""); try { await api("v1/learning/revision-notes/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ course_id: courseId }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not generate notes."); } finally { setBusy(false); } }
  async function save(note: RevisionNote) { const summary = (document.querySelector<HTMLTextAreaElement>(`[data-note-summary="${note.id}"]`)?.value || note.summary).trim(); const points = (document.querySelector<HTMLTextAreaElement>(`[data-note-points="${note.id}"]`)?.value || note.key_points.join("\n")).split("\n").map((x) => x.trim()).filter(Boolean); try { await api(`v1/learning/revision-notes/${note.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ course_id: courseId, topic: note.topic, summary, key_points: points }) }); setEditing(""); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save note."); } }
  async function remove(note: RevisionNote) { try { await api(`v1/learning/revision-notes/${note.id}?course_id=${courseId}`, { method: "DELETE" }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete note."); } }
  async function editBookmark(bookmark: Bookmark) { const note = window.prompt("Add or edit your note for this bookmark", bookmark.note || ""); if (note === null) return; try { await api(`v1/learning/bookmarks/${bookmark.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ course_id: courseId, note }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update bookmark."); } }
  async function removeBookmark(bookmark: Bookmark) { try { await api(`v1/learning/bookmarks/${bookmark.id}?course_id=${courseId}`, { method: "DELETE" }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete bookmark."); } }
  function exportNotes(kind: "md" | "pdf") { if (kind === "pdf") { window.print(); return; } const text = visible.map((n) => `# ${n.topic}\n\n${n.summary}\n\n${n.key_points.map((p) => `- ${p}`).join("\n")}\n\nSources: ${n.source_refs.map((r) => r.resource_name).join(", ")}`).join("\n\n---\n\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" })); a.download = "learnflow-revision-notes.md"; a.click(); URL.revokeObjectURL(a.href); }
  return <section className="feature-panel revision-notes"><div className="card-heading"><div><p className="eyebrow">YOUR SAVED LEARNING</p><h3>Revision notes</h3></div><div className="revision-actions"><button className="button-secondary" disabled={busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate from bookmarks"}</button><button className="button-secondary" onClick={() => exportNotes("md")}>Export .md</button><button className="button-secondary" onClick={() => exportNotes("pdf")}>Save as PDF</button></div></div><input className="revision-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search topics and notes…" />{error && <p className="feature-error">{error}</p>}{visible.length ? visible.map((note) => <article className="revision-note" key={note.id}><div className="card-heading"><strong>{note.topic}</strong><div className="revision-actions">{editing === note.id ? <button className="button-secondary" onClick={() => void save(note)}>Save edits</button> : <button className="button-secondary" onClick={() => setEditing(note.id)}>Edit</button>}<button className="button-secondary" onClick={() => void remove(note)}>Delete</button></div></div>{editing === note.id ? <><textarea data-note-summary={note.id} defaultValue={note.summary} /><textarea data-note-points={note.id} defaultValue={note.key_points.join("\n")} /></> : <><p>{note.summary}</p><ul>{note.key_points.map((point, i) => <li key={i}>{point}</li>)}</ul></>}{note.source_refs.map((ref, index) => <CitationChip key={`${ref.source_id}-${index}`} citation={{ label: ref.resource_name, source_type: ref.source_type, source_id: ref.source_id, resource_name: ref.resource_name, seek_seconds: ref.location.seconds ?? null, start_seconds: ref.location.seconds, page: ref.location.page, slide: ref.location.slide, quote: ref.quote }} onClick={onCitation} />)}</article>) : <p className="muted">No revision notes yet. Save an answer or source bookmark, then generate notes.</p>}<div className="saved-bookmark-section"><h4>Saved bookmarks</h4>{bookmarks.filter((item) => `${item.resource_name} ${item.note} ${item.saved_explanation} ${(item.concept_tags || []).join(" ")}`.toLowerCase().includes(search.toLowerCase())).map((item) => <article className="saved-bookmark" key={item.id}><div><strong>{item.concept_tags?.join(", ") || item.resource_name}</strong><small>{item.resource_name} · {item.source_type === "video" ? timeText(item.location.seconds || 0) : item.source_type === "pdf" ? `Page ${item.location.page}` : `Slide ${item.location.slide}`}</small><p>{item.note || item.saved_explanation || "No note saved."}</p></div><div className="revision-actions"><CitationChip citation={{ label: item.resource_name, source_type: item.source_type, source_id: item.source_id, resource_name: item.resource_name, seek_seconds: item.location.seconds ?? null, start_seconds: item.location.seconds, page: item.location.page, slide: item.location.slide, quote: item.saved_explanation }} onClick={onCitation} /><button className="button-secondary" onClick={() => void editBookmark(item)}>Edit note</button><button className="button-secondary" onClick={() => void removeBookmark(item)}>Delete</button></div></article>)}</div></section>;
}
