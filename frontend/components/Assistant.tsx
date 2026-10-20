"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { ANSWER_LANGUAGES, ANSWER_LANGUAGE_KEY, validAnswerLanguage, answerDirection } from "../lib/languages";
import { I18nProvider, useI18n } from "./I18nProvider";
import LocalizedFileInput from "./LocalizedFileInput";
import { type UiText, type UiMessages } from "../lib/i18n";
import LessonPlayer, { LessonPlayerHandle } from "./LessonPlayer";
import { parseVideoSource } from "../lib/video-source";
import { api } from "../lib/api";
import { cachedVideoCourse, defaultCourse, rememberCourse, type Course } from "../lib/courses";

const hasVideoNotes = (course?: Course) => course?.description?.startsWith("AI video notes · Gemini") ?? false;
const videoReadyStatus = (course: Course) => hasVideoNotes(course)
  ? "Video attached. Play it, then ask a question. The guide detects the spoken language automatically and analyzes up to five watched minutes. AI notes are approximate; summaries cover analyzed sections only."
  : "Transcript ready. Play the video, then ask about what you have watched.";

type Citation = { label: string; source_type: string; seek_seconds: number | null; resource_name: string };
type Message = { role: "user" | "assistant"; content: string; citations?: Citation[]; refusal_reason?: string | null; video_time_seconds: number; response_language?: string };
type Scorecard = { overall_score: number; dimensions: { name: string; score: number; evidence: string }[]; strengths: string[]; improvement_areas: string[]; recommendations: string[]; method: string };

function timeLabel(seconds: number) {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

type AssistantProps = { initialCourses: Course[]; preferredCourseId?: string; initialUiLocale: string; initialUiMessages: UiMessages };
export default function Assistant(props: AssistantProps) {
  return <I18nProvider initialLocale={props.initialUiLocale} initialMessages={props.initialUiMessages}><AssistantWorkspace initialCourses={props.initialCourses} preferredCourseId={props.preferredCourseId} /></I18nProvider>;
}
function AssistantWorkspace({ initialCourses, preferredCourseId }: { initialCourses: Course[]; preferredCourseId?: string }) {
  const { t, locale, chooseLocale, changingLocale, localeError, languageName, errorText, citationLabel } = useI18n();
  const initialCourse = defaultCourse(initialCourses, preferredCourseId);
  const [tab, setTab] = useState<"learn" | "interview">("learn");
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [courseId, setCourseId] = useState(initialCourse?.id || "");
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [responseLanguage, setResponseLanguage] = useState("auto");
  useEffect(() => {
    try { setResponseLanguage(validAnswerLanguage(window.localStorage.getItem(ANSWER_LANGUAGE_KEY))); } catch { /* Optional storage. */ }
  }, []);
  function chooseResponseLanguage(value: string) {
    const code = validAnswerLanguage(value);
    setResponseLanguage(code);
    try { window.localStorage.setItem(ANSWER_LANGUAGE_KEY, code); } catch { /* Optional storage. */ }
  }
  const [videoSeconds, setVideoSeconds] = useState(0);
  const [videoUrl, setVideoUrl] = useState(initialCourse?.video_url || "");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<UiText>("");
  const [file, setFile] = useState<File | null>(null);
  const playerRef = useRef<LessonPlayerHandle>(null);
  const [videoDraft, setVideoDraft] = useState(videoUrl);
  const [videoDuration, setVideoDuration] = useState(initialCourse?.video_url ? 0 : 2040);
  const [newCourseTitle, setNewCourseTitle] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [importing, setImporting] = useState(false);
  const [captionStatus, setCaptionStatus] = useState(initialCourse?.video_url ? videoReadyStatus(initialCourse) : "");
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    api<{ llm_provider: string }>("v1/status").then((status) => setDemoMode(status.llm_provider === "mock")).catch(() => {});
  }, []);

  const [role, setRole] = useState("");
  const [skillLevel, setSkillLevel] = useState("intermediate");
  const [interviewType, setInterviewType] = useState("mixed");
  const [duration, setDuration] = useState(10);
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [interviewId, setInterviewId] = useState("");
  const [interviewTurns, setInterviewTurns] = useState<{ role: string; content: string }[]>([]);
  const [interviewAnswer, setInterviewAnswer] = useState("");
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jobFile, setJobFile] = useState<File | null>(null);
  const [costEstimate, setCostEstimate] = useState<UiText>("Checking estimate…");

  useEffect(() => {
    if (tab !== "interview") return;
    api<{ estimated_cost_usd: number }>(`v1/interviews/cost?minutes=${duration}`)
      .then((result) => setCostEstimate({ key: "Estimated {minutes} min: {cost} USD", params: { minutes: duration, cost: new Intl.NumberFormat(locale, {minimumFractionDigits:5,maximumFractionDigits:5}).format(result.estimated_cost_usd) } }))
      .catch(() => setCostEstimate("Estimate unavailable"));
  }, [tab, duration, locale]);

  const startSession = useCallback(async (id: string) => {
    if (!id) return;
    // The first question creates its session atomically on the backend. Opening a
    // cached lesson should never depend on a separate session-creation request.
    setSessionId("");
    setMessages([]);
  }, []);

  useEffect(() => {
    let active = true;
    (initialCourses.length ? Promise.resolve({ courses: initialCourses }) : api<{ courses: Course[] }>("v1/courses"))
      .then(async ({ courses: available }) => {
        if (!active) return;
        setCourses(available);
        if (available.length) {
          let saved: string | undefined;
          try { saved = window.localStorage.getItem("learnflow-course") || undefined; } catch { /* Optional storage. */ }
          const chosen = defaultCourse(available, preferredCourseId || saved)!;
          setCourseId(chosen.id);
          setVideoUrl(chosen.video_url || "");
          setVideoDraft(chosen.video_url || "");
          setVideoDuration(chosen.video_url ? 0 : 2040);
          setCaptionStatus(chosen.video_url ? videoReadyStatus(chosen) : "");
          await startSession(chosen.id);
        }
      })
      .catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [startSession, initialCourses, preferredCourseId]);

  async function ask(text: string, action = "answer") {
    if (!courseId || !text.trim() || loading || importing) return;
    setLoading(true);
    setNotice("");
    const currentQuestion = text.trim();
    const askedAt = playerRef.current?.getCurrentTime() ?? videoSeconds;
    const isShortcut = ["What is this lesson about?", "Explain the idea in simpler words", "Give me a practical example", "Summarize what I have learned so far", "Quiz me on concepts covered so far", "Where was this discussed?", "Compare the concepts covered so far"].includes(currentQuestion);
    const answerLanguage = responseLanguage === "auto" && isShortcut ? locale : responseLanguage;
    setMessages((items) => [...items, { role: "user", content: currentQuestion, video_time_seconds: askedAt }]);
    setQuestion("");
    try {
      const result = await api<{ session_id: string; answer: string; citations: Citation[]; refusal_reason?: string | null }>("v1/learning/ask", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ course_id: courseId, session_id: sessionId || null, question: currentQuestion, video_time_seconds: askedAt, action, response_language: answerLanguage }),
      });
      setSessionId(result.session_id);
      setMessages((items) => [...items, { role: "assistant", content: result.answer, citations: result.citations, refusal_reason: result.refusal_reason, video_time_seconds: askedAt, response_language: answerLanguage }]);
    } catch (error) {
      setNotice(errorText(error, "Could not get an answer."));
      setQuestion(currentQuestion);
      setMessages((items) => items.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    await ask(question);
  }

  function seekTo(seconds: number | null) {
    if (seconds === null) return;
    setVideoSeconds(seconds);
    playerRef.current?.seekTo(seconds);
  }

  async function selectCourse(id: string) {
    const course = courses.find((item) => item.id === id);
    setCourseId(id);
    rememberCourse(id);
    setVideoUrl(course?.video_url || "");
    setVideoDraft(course?.video_url || "");
    setVideoSeconds(0);
    setVideoDuration(course?.video_url ? 0 : 2040);
    setCaptionStatus(course?.video_url ? videoReadyStatus(course) : "");
    setLoading(true);
    try { await startSession(id); }
    catch (error) { setNotice(errorText(error, "Could not open the lesson.")); }
    finally { setLoading(false); }
  }

  async function loadVideo(event: FormEvent) {
    event.preventDefault();
    if (loading || importing) return;
    const source = parseVideoSource(videoDraft);
    if (source.kind === "invalid") { setNotice(source.message); return; }
    if (source.kind === "empty") {
      const sample = courses.find((course) => course.id === "00000000-0000-4000-8000-000000000001");
      if (sample) await selectCourse(sample.id);
      return;
    }
    if (source.kind === "youtube") {
      const saved = cachedVideoCourse(courses, source.id);
      if (saved) {
        setNotice("");
        await selectCourse(saved.id);
        return;
      }
    }
    // Detach old sources before the request: a failed import must never use the sample course.
    setCourseId("");
    setSessionId("");
    setMessages([]);
    setVideoSeconds(0);
    setVideoDuration(0);
    setVideoUrl(videoDraft.trim());
    playerRef.current?.seekTo(0);
    setImporting(true);
    setNotice("");
    setCaptionStatus(source.kind === "youtube" ? "Preparing this video: checking captions in available languages…" : "Direct video loaded. Add its transcript below to enable questions.");
    try {
      const result = source.kind === "youtube"
        ? await api<{ course: Course; cached: boolean; language?: string }>("v1/videos/youtube/import", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: videoDraft.trim() }),
        })
        : { course: await api<Course>("v1/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "My video lesson" }) }), cached: false };
      const course = result.course;
      setCourses((items) => [...items.filter((item) => item.id !== course.id), course]);
      setCourseId(course.id);
      rememberCourse(course.id);
      await startSession(course.id);
      setCaptionStatus(source.kind === "youtube" ? videoReadyStatus(course) : "Upload this video's transcript below. Direct video files do not include captions automatically.");
    } catch (error) {
      const message = errorText(error, "Could not import captions. Please retry.");
      setCaptionStatus(message);
      setNotice(message);
    } finally { setImporting(false); }
  }

  async function createCourse(event: FormEvent) {
    event.preventDefault();
    if (!newCourseTitle.trim() || loading || importing) return;
    setLoading(true);
    try {
      const course = await api<Course>("v1/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: newCourseTitle.trim(), video_url: videoUrl || null }) });
      setCourses((items) => [...items, course]);
      setCourseId(course.id);
      await startSession(course.id);
      setNewCourseTitle("");
      setVideoUrl(course.video_url || ""); setVideoDraft(course.video_url || ""); setVideoSeconds(0); setVideoDuration(course.video_url ? 0 : 2040);
      rememberCourse(course.id);
      setCaptionStatus(course.video_url ? "Lesson created. Add its matching VTT/SRT transcript below to enable timestamp-aware questions." : "");
      setNotice(course.video_url ? "Lesson created. Upload this video's VTT/SRT transcript below; timestamps will control which passages the guide can use." : "Course created. Add its supporting materials below before asking questions.");
    } catch (error) { setNotice(errorText(error, "Could not create the course.")); }
    finally { setLoading(false); }
  }

  async function uploadResource(event: FormEvent) {
    event.preventDefault();
    if (!file || !courseId) return;
    setLoading(true);
    const data = new FormData();
    data.append("file", file);
    try {
      const result = await api<{ name: string; chunk_count: number }>(`v1/courses/${courseId}/resources`, { method: "POST", body: data });
      setNotice({ key: "Added {file} as {count} searchable passages.", params: { file: result.name, count: result.chunk_count } });
      setFile(null);
    } catch (error) {
      setNotice(errorText(error, "Could not add the resource."));
    } finally {
      setLoading(false);
    }
  }

  async function addPastedTranscript(event: FormEvent) {
    event.preventDefault();
    if (!courseId || !transcriptText.trim() || loading) return;
    setLoading(true);
    try {
      const result = await api<{ name: string; chunk_count: number }>(`v1/courses/${courseId}/transcripts`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: transcriptText }),
      });
      setNotice({ key: "Added {file} as {count} timestamped passages. Ask again at the video position you want to review.", params: { file: result.name, count: result.chunk_count } });
      setTranscriptText("");
    } catch (error) {
      setNotice(errorText(error, "Could not add the transcript."));
    } finally { setLoading(false); }
  }

  async function beginInterview(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    setScorecard(null);
    try {
      const result = await api<{ interview_id: string; question: string; candidate_skills: string[] }>("v1/interviews", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, skill_level: skillLevel, interview_type: interviewType, duration_minutes: duration, resume_text: resume, job_description: jobDescription, course_id: courseId || null, response_language: locale }),
      });
      setInterviewId(result.interview_id);
      setInterviewTurns([{ role: "interviewer", content: result.question }]);
      setNotice(result.candidate_skills.length ? {key: "Profile skills detected: {skills}", params: {skills: result.candidate_skills.join(", ")}} : "Interview ready. Add more resume or job description detail for tighter personalization.");
    } catch (error) {
      setNotice(errorText(error, "Could not start the interview."));
    } finally {
      setLoading(false);
    }
  }

  async function parseProfileFiles() {
    if (!resumeFile && !jobFile) return;
    setLoading(true);
    const data = new FormData();
    if (resumeFile) data.append("resume", resumeFile);
    if (jobFile) data.append("job_description", jobFile);
    try {
      const parsed = await api<{ resume_text?: string; job_description_text?: string; detected_skills: string[] }>("v1/interviews/profile/parse", { method: "POST", body: data });
      if (parsed.resume_text) setResume(parsed.resume_text);
      if (parsed.job_description_text) setJobDescription(parsed.job_description_text);
      setNotice(parsed.detected_skills.length ? {key: "Profile parsed. Skills found: {skills}", params: {skills: parsed.detected_skills.join(", ")}} : "Profile text extracted. Add role-relevant skills if any were missed.");
    } catch (error) {
      setNotice(errorText(error, "Could not parse the selected files."));
    } finally {
      setLoading(false);
    }
  }

  async function submitInterviewAnswer(event: FormEvent) {
    event.preventDefault();
    if (!interviewAnswer.trim() || !interviewId) return;
    setLoading(true);
    const answer = interviewAnswer.trim();
    setInterviewAnswer("");
    setInterviewTurns((items) => [...items, { role: "candidate", content: answer }]);
    try {
      const result = await api<{ finished: boolean; question?: string; turns?: { role: string; content: string }[]; scorecard?: Scorecard }>(`v1/interviews/${interviewId}/turn`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer, response_language: locale }),
      });
      if (result.finished) {
        const final = await api<{ scorecard: Scorecard }>(`v1/interviews/${interviewId}/complete`, { method: "POST" });
        setScorecard(final.scorecard);
      } else if (result.question) {
        setInterviewTurns((items) => [...items, { role: "interviewer", content: result.question! }]);
      }
    } catch (error) {
      setNotice(errorText(error, "Could not submit your answer."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label={t("Learnflow home")}><span className="brand-mark">{"L"}</span><span>{"learnflow"}<span className="brand-dot">.</span></span></a>
        <div className="topbar-right"><div className="interface-language"><label htmlFor="interface-language">{t("Interface language")}</label><select id="interface-language" value={locale} disabled={changingLocale} onChange={async (event) => {const next=event.target.value;if(await chooseLocale(next)) chooseResponseLanguage(next);}}>{ANSWER_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.native} · {languageName(language.code)}</option>)}</select>{changingLocale && <small role="status">{t("Changing language…")}</small>}</div><span className="avatar">A</span></div>
      </header>

      <section className="hero" id="top">
        <div><p className="eyebrow">{t("YOUR LEARNING STUDIO")}</p><h1>{t("Learn at your own pace.")}</h1><p className="hero-copy">{t("Ask questions as you go. Practice what you know. Keep every answer grounded in your course.")}</p></div>
        <div className="hero-chip"><span className="sparkle">✳</span><span>{t("Context aware")}<br /><strong>{t("from first minute to final interview")}</strong></span></div>
      </section>

      <nav className="workspace-tabs" aria-label={t("Workspace")}>
        <button className={tab === "learn" ? "tab active" : "tab"} onClick={() => setTab("learn")}><span>▤</span> {" "}{t("Learning room")}</button>
        <button className={tab === "interview" ? "tab active" : "tab"} onClick={() => setTab("interview")}><span>✳</span> {" "}{t("Mock interview")}{" "}<span className="new-pill">{"2X"}</span></button>
      </nav>

      {localeError && <div className="notice" role="alert">{t("Could not load this language. Please try again.")}</div>}
      {notice && <div className="notice" role="status">{t(notice)}<button onClick={() => setNotice("")} aria-label={t("Dismiss")}>×</button></div>}

      {tab === "learn" ? <section className="learning-grid">
        <div className="left-column">
          <div className="section-heading"><div><p className="eyebrow">{t("CONTINUE LEARNING")}</p><h2>{courses.find((item) => item.id === courseId)?.title || t("Course lesson")}</h2></div>
            <select aria-label={t("Select course")} value={courseId} disabled={importing || loading} onChange={(event) => void selectCourse(event.target.value)}>
              {!courseId && <option value="">{importing ? t("Importing video…") : t("No transcript connected")}</option>}
              {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
          </div>
          <div className="video-card">
            <LessonPlayer key={videoUrl} ref={playerRef} url={videoUrl} initialTime={videoSeconds} onTimeChange={setVideoSeconds} onDurationChange={setVideoDuration} />
            <div className="video-controls-extra">
              <div className="video-title"><span className="video-icon">▶</span><div><strong>{courses.find((item) => item.id === courseId)?.title || t("Lesson")}</strong><small>{videoUrl ? t("Video lesson · timestamp-aware answers") : t("Sample transcript · no video required")}</small></div></div>
              <div className="time-display">{timeLabel(videoSeconds)} <span className="time-divider">/</span> {videoDuration ? timeLabel(videoDuration) : "—"}</div>
            </div>
            <div className="timeline-wrap"><input aria-label={t("Lesson position")} type="range" min="0" max={Math.max(videoDuration, videoSeconds, 1)} step="1" disabled={Boolean(videoUrl) && !videoDuration} value={videoSeconds} onChange={(event) => seekTo(Number(event.target.value))} /><div className="timeline-labels"><span>00:00</span><span>{videoUrl ? t("Synced with the video player") : t("Move the timeline to explore the sample transcript")}</span><span>{videoDuration ? timeLabel(videoDuration) : "—"}</span></div></div>
            <form className="url-label" onSubmit={loadVideo}><label htmlFor="lesson-video-url">{t("Lesson video URL")}</label><input id="lesson-video-url" value={videoDraft} onChange={(event) => setVideoDraft(event.target.value)} placeholder={t("YouTube link or direct MP4 URL")} /><button className="button-secondary" type="submit" disabled={importing || loading}>{importing ? t("Preparing video…") : t("Load video")}</button></form>
            <p className="source-note" role="status">{t(captionStatus) || t("Paste a YouTube link and click Load video. Captions are preferred; AI video notes are used if captions cannot be reached. Preparing a new video can take about a minute.")}</p>
          </div>

          <div className="resource-card">
            <div className="card-heading"><div><p className="eyebrow">{t("COURSE LIBRARY")}</p><h3>{t("Supporting materials")}</h3></div><span className="resource-tag">{t("PDF · PPT · NOTES")}</span></div>
            <p className="muted">{t("Add a PDF, presentation, transcript, or notes. Page and slide numbers stay attached to their citations.")}</p>
            <form className="new-course-form" onSubmit={createCourse}><input aria-label={t("New course title")} value={newCourseTitle} onChange={(event) => setNewCourseTitle(event.target.value)} placeholder={videoUrl && !courseId ? t("Name this video lesson to add its transcript") : t("New lesson or course name")} minLength={2} maxLength={160} required /><button className="button-secondary" disabled={loading || importing || newCourseTitle.trim().length < 2}>{videoUrl && !courseId ? t("Create lesson for this video") : t("Create course")}</button></form>
            <form className="upload-row" onSubmit={uploadResource}><LocalizedFileInput accept=".pdf,.pptx,.vtt,.srt,.json,.txt,.md,.markdown" file={file} onChange={setFile} label={t("Resource file")} /><button className="button-secondary" disabled={!file || !courseId || loading || importing}>{t("Add resource")}{" "}<span>↗</span></button></form>
            <form className="transcript-form" onSubmit={addPastedTranscript}><label htmlFor="pasted-transcript">{t("Or paste timestamped captions")}</label><textarea id="pasted-transcript" rows={4} value={transcriptText} onChange={(event) => setTranscriptText(event.target.value)} placeholder={t("Paste captions with timestamps, e.g. [00:00:00] First sentence [00:00:04] Next sentence…")} maxLength={100000} /><p>{t("Keep the timestamps in the text. Learnflow will split them into video passages and cite their times.")}</p><button className="button-secondary" disabled={!courseId || !transcriptText.trim() || loading || importing}>{loading ? t("Adding transcript…") : t("Add transcript")}</button></form>
          </div>
        </div>

        <aside className="chat-card">
          <div className="chat-head"><div className="tutor-avatar">✳</div><div><h3>{t("Your learning guide")}</h3><p><span className="status-dot" /> {courseId ? hasVideoNotes(courses.find((item) => item.id === courseId)) ? t("AI video notes · approximate") : t("Grounded in this course") : t("Waiting for video content")}</p></div><button className="icon-button" aria-label={t("More options")}>···</button></div>
          <div className="answer-language-control"><label htmlFor="answer-language">{t("Answer language")}</label><select id="answer-language" value={responseLanguage} onChange={(event) => chooseResponseLanguage(event.target.value)} disabled={loading}><option value="auto">{t("Automatic · follow my question")}</option>{ANSWER_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{languageName(language.code)} · {language.native}</option>)}</select><small>{ANSWER_LANGUAGES.length} {" "}{t("languages · independent of the video language")}</small></div>
          {demoMode && <div className="demo-mode-note">{t("Demo responses are active. Configure a model API key in the backend to enable AI-generated explanations.")}</div>}
          <div className="context-banner"><span>◷</span><span>{t("Answering from material available up to")}{" "}<strong>{timeLabel(videoSeconds)}</strong></span></div>
          <div className="chat-scroll" aria-live="polite">
            {!messages.length && <div className="welcome-message"><div className="welcome-mark">✳</div><h4>{importing ? t("Getting your lesson ready…") : !courseId ? t("Transcript needed") : t("Curiosity makes this stick.")}</h4><p>{!courseId ? t(captionStatus) || t("Load a video to get started.") : t("Play the video, then ask about the section you have watched. Every answer uses this lesson's material.")}</p><div className="suggestion-label">{t("TRY ASKING")}</div><button className="suggestion" disabled={!courseId || importing || loading} onClick={() => ask("What is this lesson about?")}>{t("What is this lesson about?")}{" "}<span>↗</span></button><button className="suggestion" disabled={!courseId || importing || loading} onClick={() => ask("Explain the idea in simpler words", "simplify")}>{t("Explain this section simply")}{" "}<span>↗</span></button></div>}
            {messages.map((message, index) => <article className={`message ${message.role}`} key={`${index}-${message.role}`}>
              <div className="message-avatar">{message.role === "assistant" ? "✳" : "A"}</div>
              <div className="message-body"><div className="message-label">{message.role === "assistant" ? t("YOUR LEARNING GUIDE") : t("YOU")} {" "}{t("· at")}{" "}{timeLabel(message.video_time_seconds)}</div><p dir={message.role === "assistant" ? answerDirection(message.response_language) : "auto"} lang={message.response_language && message.response_language !== "auto" ? message.response_language : undefined}>{message.role === "user" ? t(message.content) : message.content}</p>
                {!!message.citations?.length && <div className="citations"><span className="citation-label">{t("SOURCES")}</span>{message.citations.map((citation) => <button key={citation.label} className="citation" onClick={() => seekTo(citation.seek_seconds)} title={citation.seek_seconds === null ? citationLabel(citation.label) : t("Seek to {time}", {time: timeLabel(citation.seek_seconds)})}><span>↗</span>{citationLabel(citation.label)}</button>)}</div>}
                {message.refusal_reason && <div className="refusal-tag">{message.refusal_reason === "future_video_content" ? t("AHEAD IN THIS LESSON") : t("COURSE SOURCES CHECKED")}</div>}
              </div>
            </article>)}
            {loading && <div className="typing"><span /><span /><span /> {" "}{t("Understanding your lesson…")}</div>}
          </div>
          <div className="quick-actions"><span>{t("QUICK ACTIONS")}</span><button disabled={!courseId || importing || loading} onClick={() => ask("Explain the idea in simpler words", "simplify")}>{t("Simplify")}</button><button disabled={!courseId || importing || loading} onClick={() => ask("Give me a practical example", "example")}>{t("Example")}</button><button disabled={!courseId || importing || loading} onClick={() => ask("Summarize what I have learned so far", "summary")}>{t("Summarize so far")}</button><button disabled={!courseId || importing || loading} onClick={() => ask("Quiz me on concepts covered so far", "quiz")}>{t("Quiz me")}</button><button disabled={!courseId || importing || loading} onClick={() => ask("Where was this discussed?", "where")}>{t("Where is this?")}</button><button disabled={!courseId || importing || loading} onClick={() => ask("Compare the concepts covered so far", "compare")}>{t("Compare concepts")}</button></div>
          <form className="composer" onSubmit={submitQuestion}><textarea disabled={!courseId || importing} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(question); } }} placeholder={t("Ask about what you’re learning…")} maxLength={1800} rows={2} /><div className="composer-footer"><span>{t("Enter to send · Shift + Enter for a new line")}</span><button className="send-button" disabled={!question.trim() || !courseId || loading || importing} aria-label={t("Send question")}>↑</button></div></form>
          <div className="chat-disclaimer">{t("Answers use retrieved course passages and may need your judgement.")}</div>
        </aside>
      </section> : <section className="interview-layout">
        <div className="interview-intro"><p className="eyebrow">{t("PRACTICE WITH PURPOSE")}</p><h2>{t("A conversation that")}<br />{t("adapts to you.")}</h2><p>{t("Bring your resume and the role you want. Your interviewer will follow up on your answers, then give you a clear, evidence-based scorecard.")}</p><div className="interview-steps"><div><span>01</span><strong>{t("Personalize")}</strong><small>{t("Role, resume and job description")}</small></div><div><span>02</span><strong>{t("Practice")}</strong><small>{t("One question at a time")}</small></div><div><span>03</span><strong>{t("Improve")}</strong><small>{t("Review strengths and next steps")}</small></div></div><div className="estimate-card"><div><span className="estimate-icon">◷</span><strong>{t("Estimated interview cost")}</strong></div><p>{t(costEstimate)}</p><small>{t("Planning estimate based on current provider settings; actual use varies.")}</small></div></div>
        <div className="interview-panel">
          {!interviewId ? <><div className="card-heading"><div><p className="eyebrow">{t("SET UP YOUR SESSION")}</p><h3>{t("Make it yours")}</h3></div><span className="secure-note">{t("PRACTICE SESSION")}</span></div>
            <form className="interview-form" onSubmit={beginInterview}><label>{t("Target role")}<input required value={role} onChange={(event) => setRole(event.target.value)} placeholder={t("e.g. Data Scientist")} /></label><div className="form-split"><label>{t("Experience level")}<select value={skillLevel} onChange={(event) => setSkillLevel(event.target.value)}><option value="beginner">{t("beginner")}</option><option value="intermediate">{t("intermediate")}</option><option value="advanced">{t("advanced")}</option></select></label><label>{t("Interview style")}<select value={interviewType} onChange={(event) => setInterviewType(event.target.value)}><option value="mixed">{t("mixed")}</option><option value="technical">{t("technical")}</option><option value="behavioral">{t("behavioral")}</option><option value="system design">{t("system design")}</option></select></label></div>
              <label>{t("Resume or experience")}<textarea rows={5} value={resume} onChange={(event) => setResume(event.target.value)} placeholder={t("Paste a few relevant projects, skills or responsibilities…")} /></label><label>{t("Job description")}<textarea rows={5} value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder={t("Paste the role requirements to personalize your questions…")} /></label>
              <div className="profile-files"><label>{t("Resume file")}{" "}<LocalizedFileInput accept=".pdf,.pptx,.txt,.md" file={resumeFile} onChange={setResumeFile} label={t("Resume file")} /></label><label>{t("Job description file")}{" "}<LocalizedFileInput accept=".pdf,.pptx,.txt,.md" file={jobFile} onChange={setJobFile} label={t("Job description file")} /></label><button type="button" className="button-secondary" disabled={loading || (!resumeFile && !jobFile)} onClick={parseProfileFiles}>{t("Extract profile text")}</button></div>
              <fieldset className="duration-select"><legend>{t("Session length")}</legend>{[10, 20, 30].map((value) => <label key={value} className={duration === value ? "duration-option selected" : "duration-option"}><input type="radio" value={value} checked={duration === value} onChange={() => setDuration(value)} />{value} {" "}{t("min")}</label>)}</fieldset>
              <button className="button-primary full-width" disabled={loading}>{loading ? t("Preparing your interview…") : t("Start mock interview")}<span>→</span></button><p className="privacy-copy">{t("Your resume and job description are used to personalize this session.")}</p>
            </form>
          </> : <><div className="card-heading"><div><p className="eyebrow">{t("LIVE PRACTICE ·")}{" "}{role.toUpperCase()}</p><h3>{t("Mock interview")}</h3></div><span className="live-tag"><i /> {" "}{t("IN PROGRESS")}</span></div>
            <div className="interview-chat">{interviewTurns.map((turn, index) => <div className={`interview-turn ${turn.role}`} key={index}><span>{turn.role === "interviewer" ? "✳" : "A"}</span><p>{turn.content}</p></div>)}{loading && <p className="muted">{t("Thinking of a follow-up…")}</p>}</div>
            {!scorecard ? <form className="interview-answer" onSubmit={submitInterviewAnswer}><textarea rows={3} value={interviewAnswer} onChange={(event) => setInterviewAnswer(event.target.value)} placeholder={t("Take a moment, then share your answer…")} maxLength={5000} /><button className="button-primary" disabled={!interviewAnswer.trim() || loading}>{t("Send answer")}{" "}<span>↑</span></button></form> : <div className="scorecard"><div className="score-summary"><span className="score-number">{scorecard.overall_score}</span><div><p className="eyebrow">{t("PRACTICE SCORE")}</p><strong>{t("Overall reflection")}</strong><small>{t(scorecard.method)}</small></div></div><div className="score-dimensions">{scorecard.dimensions.map((item) => <div key={item.name}><div><strong>{t(item.name)}</strong><b>{item.score}</b></div><div className="score-track"><i style={{ width: `${item.score}%` }} /></div><small>{t(item.evidence)}</small></div>)}</div><div className="score-columns"><div><strong>{t("Strengths")}</strong>{scorecard.strengths.map((item) => <p key={item}>✓ {t(item)}</p>)}</div><div><strong>{t("Next to practice")}</strong>{scorecard.improvement_areas.map((item) => <p key={item}>↗ {t(item)}</p>)}</div></div><button className="button-secondary" onClick={() => { setInterviewId(""); setInterviewTurns([]); setScorecard(null); }}>{t("Start another practice")}</button></div>}
          </>}
        </div>
      </section>}

      <footer className="footer"><span>{"LEARNFLOW"}{" "}<i>✳</i></span><span>{t("Watch · Ask · Understand · Practice")}</span><span>{t("Built for curious minds")}</span></footer>
    </main>
  );
}
