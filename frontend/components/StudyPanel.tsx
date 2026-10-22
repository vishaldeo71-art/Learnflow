"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "./I18nProvider";
import EvidenceSources, { type Evidence } from "./EvidenceSources";

type Feedback = {
  question_id: string;
  selected: number;
  correct: boolean;
  correct_index: number;
  explanation: string;
  topic: string;
  topic_key: string;
  citations: Evidence[];
};
type Quiz = {
  id: string;
  course_id: string;
  video_time_seconds: number;
  response_language: string;
  questions: {
    id: string;
    question: string;
    options: string[];
    topic: string;
    topic_key: string;
    difficulty: number;
  }[];
  answers: Record<string, Feedback>;
};
type Payload = {
  title: string;
  content: string;
  video_time_seconds: number;
  citations: Evidence[];
  kind?: string;
  response_language?: string;
};
type Item = {
  id: string;
  course_id: string;
  payload: Payload;
  created_at: string;
  last_reviewed_at: string | null;
};
type Topic = {
  topic_key: string;
  title: string;
  incorrect: number;
  attempts: number;
  correct_streak: number;
  difficulty: number;
  last_reviewed_at: string | null;
};
type QueueItem = {
  id: string;
  kind: "topics" | "bookmarks";
  title: string;
  incorrect?: number;
  priority: number;
  payload?: Payload;
};
type Overview = {
  notes: Item[];
  bookmarks: Item[];
  topics: Topic[];
  revision_queue: QueueItem[];
  recent_quizzes: Quiz[];
  profile: { auto_notes: boolean };
};

export default function StudyPanel({
  courseId,
  videoSeconds,
  getTime,
  responseLanguage,
  quizRequest,
  onSeek,
  videoUrl,
  refreshKey = 0,
}: {
  courseId: string;
  videoSeconds: number;
  getTime: () => number;
  responseLanguage: string;
  quizRequest: number;
  onSeek: (seconds: number) => void;
  videoUrl?: string | null;
  refreshKey?: number;
}) {
  const { t, locale, errorText } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [view, setView] = useState<"quiz" | "notes" | "revision">("quiz");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const version = useRef(0);
  const previousRequest = useRef(quizRequest);
  async function refresh() {
    const current = version.current;
    const result = await api<Overview>(
      `v1/study/overview?course_id=${encodeURIComponent(courseId)}`,
    );
    if (current === version.current) setData(result);
    return result;
  }
  useEffect(() => {
    version.current++;
    const current = version.current;
    setData(null);
    setQuiz(null);
    setChoices({});
    setNotice("");
    if (!courseId) return;
    api<Overview>(`v1/study/overview?course_id=${encodeURIComponent(courseId)}`)
      .then((result) => {
        if (current !== version.current) return;
        setData(result);
        const unfinished = result.recent_quizzes.find(
          (q) => Object.keys(q.answers).length < q.questions.length,
        );
        if (unfinished) setQuiz(unfinished);
      })
      .catch((error) => {
        if (current === version.current)
          setNotice(
            errorText(
              error,
              "Could not load your study progress. Please retry.",
            ),
          );
      });
    return () => {
      version.current++;
    };
  }, [courseId, refreshKey, errorText]);
  useEffect(() => {
    if (quizRequest !== previousRequest.current) {
      setView("quiz");
      document
        .getElementById("study-studio")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      previousRequest.current = quizRequest;
      void startQuiz();
    }
  }, [quizRequest]);
  async function startQuiz(topicKey?: string) {
    if (!courseId || busy) return;
    const current = version.current;
    setBusy(true);
    setNotice("");
    try {
      const result = await api<Quiz>("v1/study/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: courseId,
          video_time_seconds: getTime(),
          response_language:
            responseLanguage === "auto" ? locale : responseLanguage,
          topic_key: topicKey || null,
        }),
      });
      if (current !== version.current) return;
      setQuiz(result);
      setChoices({});
      setView("quiz");
      await refresh();
    } catch (error) {
      if (current === version.current)
        setNotice(errorText(error, "Could not create a quiz. Please retry."));
    } finally {
      setBusy(false);
    }
  }
  async function submitAnswer(questionId: string) {
    if (!quiz || choices[questionId] === undefined || busy) return;
    const quizId = quiz.id,
      current = version.current;
    setBusy(true);
    setNotice("");
    try {
      const result = await api<Feedback>(`v1/study/quizzes/${quizId}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: questionId,
          selected: choices[questionId],
        }),
      });
      if (current !== version.current) return;
      setQuiz((value) =>
        value?.id === quizId
          ? { ...value, answers: { ...value.answers, [questionId]: result } }
          : value,
      );
      await refresh();
    } catch (error) {
      setNotice(errorText(error, "Could not submit your answer."));
    } finally {
      setBusy(false);
    }
  }
  async function bookmark(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      await api("v1/study/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: courseId,
          title: title.trim(),
          note: note.trim(),
          video_time_seconds: getTime(),
        }),
      });
      setTitle("");
      setNote("");
      await refresh();
      setNotice("Bookmark saved to your revision queue.");
    } catch (error) {
      setNotice(errorText(error, "Could not save the bookmark. Please retry."));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string) {
    setBusy(true);
    setNotice("");
    try {
      await api(path, { method: "POST" });
      await refresh();
    } catch (error) {
      setNotice(
        errorText(error, "Could not update your study progress. Please retry."),
      );
    } finally {
      setBusy(false);
    }
  }
  function exportNotes() {
    if (!data) return;
    const text = data.notes
      .map(
        (item) =>
          `# ${item.payload.title}\n\n${item.payload.content}\n\n${item.payload.citations.map((c) => `${c.label}${c.seek_seconds !== null && videoUrl ? ` — ${videoUrl}&t=${c.seek_seconds}s` : c.resource_id ? ` — ${window.location.origin}/api/v1/resources/${c.resource_id}/file${c.page_number ? `#page=${c.page_number}` : ""}` : ""}\n${c.excerpt || ""}`).join("\n\n")}`,
      )
      .join("\n\n---\n\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "learnflow-revision-notes.md";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="study-studio" id="study-studio">
      <div className="study-heading">
        <div>
          <p className="eyebrow">{t("MAKE LEARNING LAST")}</p>
          <h2>{t("Your study studio")}</h2>
          <p className="muted">
            {t(
              "Practice what you watched. Save what matters. Revisit what needs work.",
            )}
          </p>
        </div>
        <span className="resource-tag">{t("PRIVATE TO YOU")}</span>
      </div>
      <nav className="study-tabs" aria-label={t("Study tools")}>
        {(
          [
            ["quiz", "Adaptive quiz"],
            ["notes", "Bookmarks & notes"],
            ["revision", "Revision planner"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={view === key ? "selected" : ""}
            onClick={() => setView(key)}
          >
            {t(label)}
          </button>
        ))}
      </nav>
      {notice && (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      )}
      {!courseId ? (
        <p className="muted">
          {t("Choose a course to open your study tools.")}
        </p>
      ) : (
        <>
          {view === "quiz" && (
            <>
              <div className="study-section-heading">
                <div>
                  <h3>{t("A short quiz. A smarter next step.")}</h3>
                  <p className="muted">
                    {t(
                      "Questions use only the material available at your current video position.",
                    )}
                  </p>
                </div>
                <button
                  className="button-primary"
                  disabled={busy}
                  onClick={() => void startQuiz()}
                >
                  {t(
                    busy
                      ? "Please wait…"
                      : quiz
                        ? "New quiz"
                        : "Start a short quiz",
                  )}
                </button>
              </div>
              {quiz && (
                <div className="quiz">
                  <div className="study-actions">
                    <strong>
                      {t("{answered} of {total} answered", {
                        answered: Object.keys(quiz.answers).length,
                        total: quiz.questions.length,
                      })}
                    </strong>
                    <span className="muted">
                      {t("Generated at {time}", {
                        time: formatTime(quiz.video_time_seconds),
                      })}
                    </span>
                  </div>
                  {quiz.questions.map((q, index) => {
                    const feedback = quiz.answers[q.id];
                    return (
                      <article className="quiz-question" key={q.id}>
                        <p className="eyebrow">
                          {t("Question {number}", { number: index + 1 })}
                          {" · "}
                          {t(
                            q.difficulty === 1
                              ? "Foundations"
                              : q.difficulty === 2
                                ? "Application"
                                : "Reasoning",
                          )}
                        </p>
                        <h4 dir="auto">{q.question}</h4>
                        <fieldset disabled={!!feedback || busy}>
                          <legend className="sr-only">{q.question}</legend>
                          {q.options.map((option, i) => (
                            <label
                              className={`quiz-option ${feedback?.correct_index === i ? "correct" : ""} ${feedback && !feedback.correct && feedback.selected === i ? "incorrect" : ""}`}
                              key={i}
                            >
                              <input
                                type="radio"
                                name={q.id}
                                checked={
                                  (feedback?.selected ?? choices[q.id]) === i
                                }
                                onChange={() =>
                                  setChoices((values) => ({
                                    ...values,
                                    [q.id]: i,
                                  }))
                                }
                              />
                              <span dir="auto">{option}</span>
                            </label>
                          ))}
                        </fieldset>
                        {!feedback ? (
                          <button
                            className="button-primary"
                            disabled={busy || choices[q.id] === undefined}
                            onClick={() => void submitAnswer(q.id)}
                          >
                            {t("Check answer")}
                          </button>
                        ) : (
                          <div className="quiz-feedback" role="status">
                            <strong>
                              {t(
                                feedback.correct
                                  ? "Correct — keep going."
                                  : "Let’s strengthen this concept.",
                              )}
                            </strong>
                            <p dir="auto">{feedback.explanation}</p>
                            <EvidenceSources
                              citations={feedback.citations}
                              onSeek={onSeek}
                              videoUrl={videoUrl}
                            />
                            {!feedback.correct && (
                              <button
                                className="button-secondary"
                                disabled={busy}
                                onClick={() =>
                                  void startQuiz(feedback.topic_key)
                                }
                              >
                                {t("Try a focused question")}
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
              {!!data?.topics.length && (
                <div className="weak-topics">
                  <h3>{t("Topic progress")}</h3>
                  {data.topics.map((topic) => (
                    <div className="topic-row" key={topic.topic_key}>
                      <div>
                        <strong dir="auto">{topic.title}</strong>
                        <p className="muted">
                          {t("{mistakes} mistakes in {attempts} attempts", {
                            mistakes: topic.incorrect,
                            attempts: topic.attempts,
                          })}
                          {" · "}
                          {t("{streak} correct in a row", {
                            streak: topic.correct_streak,
                          })}
                        </p>
                      </div>
                      <button
                        className="button-secondary"
                        disabled={busy}
                        onClick={() => void startQuiz(topic.topic_key)}
                      >
                        {t("Focused practice")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {view === "notes" && (
            <>
              <div className="study-section-heading">
                <div>
                  <h3>{t("A library of your understanding")}</h3>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={data?.profile.auto_notes ?? true}
                      onChange={async (e) => {
                        try {
                          await api("v1/account/preferences", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              auto_notes: e.target.checked,
                            }),
                          });
                          await refresh();
                        } catch (error) {
                          setNotice(
                            errorText(
                              error,
                              "Could not update your study progress. Please retry.",
                            ),
                          );
                        }
                      }}
                    />
                    {t("Automatically save important concepts")}
                  </label>
                </div>
                <button
                  className="button-secondary"
                  onClick={exportNotes}
                  disabled={!data?.notes.length}
                >
                  {t("Export revision notes")}
                </button>
              </div>
              <form className="bookmark-form" onSubmit={bookmark}>
                <h4>
                  {t("Bookmark a confusing moment")}
                  {" · "}
                  {formatTime(videoSeconds)}
                </h4>
                <label>
                  {t("What would you like to revisit?")}
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    required
                    placeholder={t("Name the concept or question")}
                  />
                </label>
                <label>
                  {t("Your note (optional)")}
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </label>
                <button className="button-primary" disabled={busy}>
                  {t("Save timestamp bookmark")}
                </button>
              </form>
              <h3>{t("Saved bookmarks")}</h3>
              {!data?.bookmarks.length && (
                <p className="muted">
                  {t(
                    "Bookmark a moment or save an explanation from the learning guide.",
                  )}
                </p>
              )}
              {data?.bookmarks.map((item) => (
                <article className="saved-note" key={item.id}>
                  <h4 dir="auto">{item.payload.title}</h4>
                  <p dir="auto">{item.payload.content}</p>
                  <div className="study-actions">
                    <button
                      className="text-button"
                      onClick={() => onSeek(item.payload.video_time_seconds)}
                    >
                      {t("Return to {time}", {
                        time: formatTime(item.payload.video_time_seconds),
                      })}
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(`v1/study/bookmarks/${item.id}/delete`)
                      }
                    >
                      {t("Remove")}
                    </button>
                  </div>
                  <EvidenceSources
                    citations={item.payload.citations}
                    onSeek={onSeek}
                    videoUrl={videoUrl}
                  />
                </article>
              ))}
              <h3>{t("Revision notes")}</h3>
              {!data?.notes.length && (
                <p className="muted">
                  {t(
                    "Important concepts from supported answers and completed quiz questions will appear here.",
                  )}
                </p>
              )}
              {data?.notes.map((item) => (
                <article className="saved-note" key={item.id}>
                  <p className="eyebrow">
                    {t(
                      item.payload.kind === "quiz"
                        ? "QUIZ CONCEPT"
                        : item.payload.kind === "concept"
                          ? "AUTO-SAVED CONCEPT"
                          : "SAVED EXPLANATION",
                    )}
                  </p>
                  <h4 dir="auto">{item.payload.title}</h4>
                  <p dir="auto">{item.payload.content}</p>
                  <EvidenceSources
                    citations={item.payload.citations}
                    onSeek={onSeek}
                    videoUrl={videoUrl}
                  />
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(`v1/study/notes/${item.id}/delete`)
                    }
                  >
                    {t("Remove")}
                  </button>
                </article>
              ))}
            </>
          )}
          {view === "revision" && (
            <>
              <h3>{t("What to revise next")}</h3>
              <p className="muted">
                {t(
                  "Ranked by mistakes and time since your last review. Reviewed topics return after one day; three correct answers in a row clear a weak topic.",
                )}
              </p>
              {!data?.revision_queue.length && (
                <div className="study-empty">
                  <h4>{t("You’re up to date.")}</h4>
                  <p>
                    {t(
                      "Take a quiz or save a bookmark to build your revision queue.",
                    )}
                  </p>
                </div>
              )}
              {data?.revision_queue.map((item, index) => (
                <article
                  className="revision-item"
                  key={`${item.kind}:${item.id}`}
                >
                  <span className="revision-rank">{index + 1}</span>
                  <div>
                    <p className="eyebrow">
                      {t(
                        item.kind === "topics"
                          ? "WEAK TOPIC"
                          : "SAVED BOOKMARK",
                      )}
                    </p>
                    <h4 dir="auto">{item.title}</h4>
                    {item.incorrect !== undefined && (
                      <p className="muted">
                        {t("{mistakes} mistakes recorded", {
                          mistakes: item.incorrect,
                        })}
                      </p>
                    )}
                    <div className="study-actions">
                      {item.kind === "topics" ? (
                        <button
                          className="button-primary"
                          disabled={busy}
                          onClick={() => void startQuiz(item.id)}
                        >
                          {t("Focused practice")}
                        </button>
                      ) : (
                        <button
                          className="button-primary"
                          onClick={() =>
                            onSeek(item.payload!.video_time_seconds)
                          }
                        >
                          {t("Revisit this moment")}
                        </button>
                      )}
                      <button
                        className="button-secondary"
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            `v1/study/${item.kind}/${encodeURIComponent(item.id)}/review`,
                          )
                        }
                      >
                        {t("Mark reviewed")}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
function formatTime(value: number) {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
