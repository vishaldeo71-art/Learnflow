"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { watchedAdvance, type PlaybackSample } from "../lib/watch-progress";
import { useI18n } from "./I18nProvider";
import EvidenceSources, { type Evidence } from "./EvidenceSources";

type Tool = "formula" | "recall" | "twins" | "memory" | "sheet" | "checkpoint";
type Artifact = {
  title: string;
  sections: { key: string; content: string[] }[];
  comparison: { aspect: string; left: string; right: string }[];
  left_title: string;
  right_title: string;
  citations: Evidence[];
};
type Feedback = {
  correct: boolean;
  reference_answer: string;
  explanation: string;
  citations: Evidence[];
  next_review_at: string;
};
type Recall = {
  id: string;
  questions: { id: string; question: string }[];
  answers: Record<string, Feedback>;
};
const HEADINGS: Record<string, string> = {
  original_formula: "Original formula",
  symbols: "Symbol breakdown",
  meaning: "Conceptual meaning",
  example_assumptions: "Assumptions for the example",
  example_steps: "Worked example",
  mistakes: "Common mistakes",
  practice: "Quick practice",
  confusion: "Common confusion",
  memory_tip: "Memory tip",
  fact: "The real fact",
  memory_aid: "Your memory aid",
  concepts: "Important concepts",
  terms: "Exact factual terms",
  formulas: "Formula summaries",
  provisions: "Provisions and classifications",
  confusions: "Don’t mix these up",
  facts: "Three important facts",
};
const TOOLS: { value: Tool; label: string }[] = [
  { value: "formula", label: "Formula Decoder" },
  { value: "recall", label: "Precision Recall" },
  { value: "twins", label: "Confusion Twins" },
  { value: "memory", label: "Memory Hooks" },
  { value: "sheet", label: "One-Shot Memory Sheet" },
  { value: "checkpoint", label: "Smart Checkpoint" },
];

export default function IntelligencePanel({
  openRequest,
  courseId,
  videoSeconds,
  getTime,
  getPlaybackSample,
  responseLanguage,
  onSeek,
  videoUrl,
  onSaved,
}: {
  openRequest: number;
  courseId: string;
  videoSeconds: number;
  getTime: () => number;
  getPlaybackSample: () => PlaybackSample;
  responseLanguage: string;
  onSeek: (seconds: number) => void;
  videoUrl?: string | null;
  onSaved: () => void;
}) {
  const { t, locale, errorText } = useI18n();
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("formula");
  const [focus, setFocus] = useState("");
  const [subject, setSubject] = useState("Current lesson");
  const [memoryFormat, setMemoryFormat] = useState("mnemonic");
  const [result, setResult] = useState<Artifact | null>(null);
  const [quiz, setQuiz] = useState<Recall | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const [interval, setIntervalMinutes] = useState(10);
  const [watched, setWatched] = useState(0);
  const [checkpointAt, setCheckpointAt] = useState(600);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (openRequest) {
      setOpen(true);
      requestAnimationFrame(() =>
        document
          .getElementById("intelligence-studio")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }, [openRequest]);
  const generation = useRef(0);
  const sampleRef = useRef(getPlaybackSample);
  sampleRef.current = getPlaybackSample;
  useEffect(() => {
    generation.current++;
    setResult(null);
    setQuiz(null);
    setFeedback(null);
    setAnswer("");
    setNotice("");
    setWatched(0);
    setCheckpointAt(interval * 60);
    setBusy(false);
  }, [courseId]);
  useEffect(() => {
    let previous: PlaybackSample | null = null;
    const timer = window.setInterval(() => {
      const sample = sampleRef.current();
      const seconds = watchedAdvance(previous, sample);
      previous = sample;
      if (seconds) setWatched((value) => value + seconds);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [courseId]);
  function selectTool(value: Tool) {
    generation.current++;
    setTool(value);
    setResult(null);
    setQuiz(null);
    setFeedback(null);
    setNotice("");
    setAnswer("");
    setBusy(false);
  }
  async function generate(selected: Tool = tool, selectedFocus = focus) {
    if (!courseId || busy) return;
    const version = ++generation.current;
    setBusy(true);
    setNotice("");
    setResult(null);
    setQuiz(null);
    setFeedback(null);
    setAnswer("");
    setTool(selected);
    setOpen(true);
    try {
      const data = await api<{
        result?: Artifact;
        quiz?: Recall;
        saved?: boolean;
      }>("v1/intelligence/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: courseId,
          video_time_seconds: getTime(),
          response_language:
            responseLanguage === "auto" ? locale : responseLanguage,
          tool: selected,
          focus: selectedFocus,
          subject,
          memory_format: memoryFormat,
        }),
      });
      if (version !== generation.current) return;
      setResult(data.result || null);
      setQuiz(data.quiz || null);
      setSaved(!!data.saved);
      if (data.saved) onSaved();
      if (selected === "checkpoint") setCheckpointAt(watched + interval * 60);
    } catch (error) {
      if (version === generation.current)
        setNotice(
          errorText(
            error,
            "The study tool could not verify its output against the available sources. Please retry or add clearer material.",
          ),
        );
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  async function checkAnswer() {
    if (!quiz || !answer.trim() || busy) return;
    const version = generation.current;
    setBusy(true);
    setNotice("");
    try {
      const data = await api<Feedback>(
        `v1/intelligence/recall/${quiz.id}/answers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_id: quiz.questions[0].id,
            answer: answer.trim(),
          }),
        },
      );
      if (version !== generation.current) return;
      setFeedback(data);
      onSaved();
    } catch (error) {
      if (version === generation.current)
        setNotice(errorText(error, "Could not submit your answer."));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  async function retry() {
    if (!quiz || busy) return;
    setBusy(true);
    setNotice("");
    const version = generation.current;
    try {
      const data = await api<Recall>(
        `v1/intelligence/recall/${quiz.id}/retry`,
        { method: "POST" },
      );
      if (version !== generation.current) return;
      setQuiz(data);
      setAnswer("");
      setFeedback(null);
    } catch (error) {
      setNotice(errorText(error, "Could not create a quiz. Please retry."));
    } finally {
      setBusy(false);
    }
  }
  function resultText() {
    if (!result) return "";
    return (
      `# ${result.title}\n\n` +
      (result.comparison.length
        ? `${result.left_title} / ${result.right_title}\n${result.comparison.map((row) => `${row.aspect}: ${row.left} / ${row.right}`).join("\n")}\n\n`
        : "") +
      result.sections
        .map(
          (section) =>
            `## ${t(HEADINGS[section.key])}\n${section.content.join("\n\n")}`,
        )
        .join("\n\n") +
      "\n\n" +
      t("SUPPORTING EVIDENCE") +
      "\n" +
      result.citations
        .map(
          (c) =>
            `${c.label}${c.seek_seconds !== null && videoUrl ? ` — ${videoUrl}&t=${c.seek_seconds}s` : ""}\n${c.excerpt || ""}`,
        )
        .join("\n\n")
    );
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([resultText()], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "learnflow-memory-sheet.md";
    link.click();
    URL.revokeObjectURL(url);
  }
  const checkpointDue = enabled && watched >= checkpointAt;
  return (
    <section className="intelligence-studio" id="intelligence-studio">
      <button
        className="intelligence-toggle"
        aria-expanded={open}
        aria-controls="intelligence-tools"
        onClick={() => setOpen(!open)}
      >
        <span>
          {"✧ "}
          {t("Study Tools")}
        </span>
        <small>{t("Understand. Remember. Recall.")}</small>
        <span>{open ? "−" : "+"}</span>
      </button>
      {checkpointDue && (
        <div className="checkpoint-offer" role="status">
          <strong>{t("Your next learning checkpoint is ready.")}</strong>
          <div className="study-actions">
            <button
              className="button-primary"
              disabled={busy}
              onClick={() => void generate("checkpoint", "")}
            >
              {t("Review watched material")}
            </button>
            <button
              className="text-button"
              onClick={() => setCheckpointAt(watched + interval * 60)}
            >
              {t("Later")}
            </button>
          </div>
          <small>
            {t("Playback continues. Checkpoints never pause your video.")}
          </small>
        </div>
      )}
      {open && (
        <div id="intelligence-tools" className="intelligence-body">
          <p className="muted">
            {t(
              "Sourced study tools for your current lesson. Video material stays restricted to your playhead.",
            )}
          </p>
          <div className="intelligence-controls">
            <label>
              {t("Choose a study tool")}
              <select
                value={tool}
                onChange={(event) => selectTool(event.target.value as Tool)}
              >
                {TOOLS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(item.label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Subject")}
              <select
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              >
                {[
                  "Current lesson",
                  "Biology",
                  "Law",
                  "Medicine",
                  "Mathematics",
                  "Physics",
                  "Computer science",
                  "Other",
                ].map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {tool === "memory" && (
            <label className="tool-label">
              {t("Memory aid format")}
              <select
                value={memoryFormat}
                onChange={(e) => setMemoryFormat(e.target.value)}
              >
                {["mnemonic", "acronym", "analogy", "story", "association"].map(
                  (value) => (
                    <option value={value} key={value}>
                      {t(value)}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
          <label className="tool-label">
            {t(
              tool === "formula"
                ? "Formula or concept to explain"
                : tool === "twins"
                  ? "Two concepts to compare"
                  : "Concept or facts to focus on (optional)",
            )}
            <textarea
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              maxLength={1600}
              rows={2}
              placeholder={t(
                "Leave blank to use the current lesson’s available material.",
              )}
            />
          </label>
          <div className="study-actions">
            <button
              className="button-primary"
              disabled={busy || !courseId}
              onClick={() => void generate()}
            >
              {t(
                busy
                  ? "Working from your sources…"
                  : tool === "recall"
                    ? "Start precision recall"
                    : tool === "formula"
                      ? "Explain Formula"
                      : tool === "twins"
                        ? "Don’t Mix These Up!"
                        : tool === "memory"
                          ? "Make It Memorable"
                          : "Generate study aid",
              )}
            </button>
            <span className="muted">
              {t("At {time}", { time: formatTime(videoSeconds) })}
            </span>
          </div>
          {notice && (
            <p role="alert" className="notice">
              {t(notice)}
            </p>
          )}
          {busy && (
            <p className="muted" role="status">
              {t("Checking the material and its source quotations…")}
            </p>
          )}
          {quiz && (
            <article className="recall-card">
              <p className="eyebrow">{t("PRECISION RECALL CHALLENGE")}</p>
              <h3 dir="auto">{quiz.questions[0].question}</h3>
              <p className="muted">
                {t(
                  "Recall the exact term or identifier. Case and superficial spelling differences are accepted unless precision is essential.",
                )}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void checkAnswer();
                }}
              >
                <label className="tool-label">
                  {t("Your recalled answer")}
                  <input
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    required
                    maxLength={600}
                    disabled={!!feedback || busy}
                    autoComplete="off"
                  />
                </label>
                {!feedback && (
                  <button
                    className="button-primary"
                    disabled={!answer.trim() || busy}
                  >
                    {t("Check recall")}
                  </button>
                )}
              </form>
              {feedback && (
                <div className="quiz-feedback" role="status">
                  <strong>
                    {t(
                      feedback.correct
                        ? "Correct — keep going."
                        : "Let’s strengthen this concept.",
                    )}
                  </strong>
                  <h4>{t("Verified reference answer")}</h4>
                  <small>
                    {t("Checked against the cited course quotation.")}
                  </small>
                  <p dir="auto">{feedback.reference_answer}</p>
                  <p dir="auto">{feedback.explanation}</p>
                  <EvidenceSources
                    citations={feedback.citations}
                    onSeek={onSeek}
                    videoUrl={videoUrl}
                  />
                  <p className="muted">
                    {t(
                      feedback.correct
                        ? "Next review: tomorrow."
                        : "This topic is now due in your revision queue.",
                    )}
                  </p>
                  <div className="study-actions">
                    <button
                      className="button-secondary"
                      disabled={busy}
                      onClick={() => void retry()}
                    >
                      {t("Try again")}
                    </button>
                    <button
                      className="button-primary"
                      disabled={busy}
                      onClick={() => void generate("recall")}
                    >
                      {t("Next recall question")}
                    </button>
                  </div>
                </div>
              )}
            </article>
          )}
          {result && (
            <article className="intelligence-result">
              <h3 dir="auto">{result.title}</h3>
              <p className="muted">
                {t(
                  "Based on the available course passages, not an exhaustive record of the lecture.",
                )}
              </p>
              {result.comparison.length > 0 && (
                <div className="comparison-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Key difference")}</th>
                        <th dir="auto">{result.left_title}</th>
                        <th dir="auto">{result.right_title}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.comparison.map((row, index) => (
                        <tr key={index}>
                          <th dir="auto">{row.aspect}</th>
                          <td dir="auto">{row.left}</td>
                          <td dir="auto">{row.right}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.sections.map((section) => (
                <section
                  className={`tool-section ${section.key === "original_formula" ? "formula-block" : ""}`}
                  key={section.key}
                >
                  <h4>{t(HEADINGS[section.key])}</h4>
                  {[
                    "example_assumptions",
                    "example_steps",
                    "memory_aid",
                    "memory_tip",
                  ].includes(section.key) && (
                    <small className="supplementary-label">
                      {t(
                        "Supplementary illustration or memory aid — not a lecturer quotation",
                      )}
                    </small>
                  )}
                  {section.content.map((text, index) => (
                    <p key={index} dir="auto">
                      {text}
                    </p>
                  ))}
                </section>
              ))}
              <EvidenceSources
                citations={result.citations}
                onSeek={onSeek}
                videoUrl={videoUrl}
              />
              <div className="study-actions">
                {tool === "memory" && (
                  <button
                    className="button-primary"
                    disabled={busy}
                    onClick={() =>
                      void generate(
                        "recall",
                        result.sections
                          .find((s) => s.key === "fact")
                          ?.content.join(" ") || focus,
                      )
                    }
                  >
                    {t("Test My Memory")}
                  </button>
                )}
                <button className="button-secondary" onClick={download}>
                  {t("Download study sheet")}
                </button>
                <button
                  className="button-secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(resultText());
                      setNotice("Copied to clipboard.");
                    } catch {
                      setNotice(
                        "Could not copy. Download the study sheet instead.",
                      );
                    }
                  }}
                >
                  {t("Copy")}
                </button>
              </div>
              <p className="muted">
                {t(
                  saved
                    ? "Saved to your private revision notes."
                    : "Session result only. Enable automatic concept notes to save future study aids.",
                )}
              </p>
            </article>
          )}
          <details className="one-shot-settings">
            <summary>{t("One-Shot Survival Mode")}</summary>
            <p className="muted">
              {t(
                "Optional checkpoints count advancing video playback, not time spent on this page. Seeking does not add watched time.",
              )}
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              {t("Offer smart checkpoints")}
            </label>
            <label className="tool-label">
              {t("Checkpoint interval")}
              <select
                value={interval}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setIntervalMinutes(value);
                  setCheckpointAt(watched + value * 60);
                }}
              >
                <option value={10}>
                  {t("{minutes} watched minutes", { minutes: 10 })}
                </option>
                <option value={15}>
                  {t("{minutes} watched minutes", { minutes: 15 })}
                </option>
              </select>
            </label>
            <p className="muted">
              {t("Watched in this session: {time}", {
                time: formatTime(Math.floor(watched)),
              })}
            </p>
            <div className="study-actions">
              <button
                className="button-secondary"
                disabled={busy || !courseId}
                onClick={() => void generate("checkpoint", "")}
              >
                {t("Create a checkpoint now")}
              </button>
              <button
                className="button-primary"
                disabled={busy || !courseId}
                onClick={() => void generate("sheet", "")}
              >
                {t("Generate Memory Sheet")}
              </button>
            </div>
          </details>
          <p className="tool-limitation">
            {t(
              "Diagram Explainer is deferred: document processing currently extracts text, not diagram images. Verified Exam Facts is deferred until authoritative external retrieval is connected. Course-only mode remains the default.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}
function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
