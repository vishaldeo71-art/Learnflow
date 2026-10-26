"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "./I18nProvider";
import { ANSWER_LANGUAGES } from "../lib/languages";
import { api } from "../lib/api";
import { demoAnswer, progressTotals, speechText, voiceCommand, type CompanionAnswer, type Gesture, type StudyOverview } from "../lib/companion";
import LumiAvatar from "./LumiAvatar";
import ConceptBoard from "./ConceptBoard";
import EvidenceSources from "./EvidenceSources";

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: {results: ArrayLike<{isFinal: boolean; 0: {transcript: string}}>}) => void) | null;
  onerror: ((event: {error: string}) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type SpeechWindow = Window & {SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition};
type Props = {courseId?: string; courseTitle?: string; videoSeconds?: number; responseLanguage?: string; refresh?: number;
  videoUrl?: string; getCurrentTime?: () => number; onSeek?: (time: number) => void; onQuiz?: () => void; onChanged?: () => void; demo?: boolean};

export default function LumiCompanion({courseId, courseTitle, videoSeconds = 0, responseLanguage = "auto", refresh = 0, videoUrl, getCurrentTime, onSeek, onQuiz, onChanged, demo = false}: Props) {
  const {t, locale, errorText} = useI18n();
  const [open, setOpen] = useState(demo);
  const [tab, setTab] = useState<"ask" | "progress" | "visual">("ask");
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<CompanionAnswer | null>(null);
  const [session, setSession] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [voiceOverride, setVoiceOverride] = useState("");
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [gesture, setGesture] = useState<Gesture>("idle");
  const [notice, setNotice] = useState("");
  const [overview, setOverview] = useState<StudyOverview | null>(null);
  const [progressError, setProgressError] = useState(false);
  const [progressLoading, setProgressLoading] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const request = useRef<AbortController | null>(null);
  const progressRequest = useRef<AbortController | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const speech = useRef<SpeechSynthesisUtterance | null>(null);
  const alive = useRef(true);
  const requestId = useRef(0);
  const voiceLanguage = voiceOverride || (responseLanguage === "auto" ? locale : responseLanguage);

  function stopAudio() {
    recognition.current?.abort(); recognition.current = null; setListening(false);
    if (speech.current) {speech.current.onend = null; speech.current.onerror = null; window.speechSynthesis?.cancel(); speech.current = null;}
    setSpeaking(false);
  }
  function close() {requestId.current++; request.current?.abort(); setBusy(false); stopAudio(); setOpen(false); launcher.current?.focus();}
  useEffect(() => {
    alive.current = true;
    const host = window as SpeechWindow;
    setVoiceAvailable(!!(host.SpeechRecognition || host.webkitSpeechRecognition));
    setSpeechAvailable("speechSynthesis" in host);
    return () => {alive.current = false; request.current?.abort(); progressRequest.current?.abort(); recognition.current?.abort(); if (speech.current) window.speechSynthesis?.cancel();};
  }, []);
  useEffect(() => {
    requestId.current++; request.current?.abort(); stopAudio();
    setResult(null); setSession(undefined); setDraft(""); setBusy(false); setNotice(""); setOverview(null); setGesture("idle"); setTab("ask");
  }, [courseId]); // A new lesson can never inherit the previous course's conversation or audio.
  useEffect(() => {stopAudio();}, [voiceLanguage]);
  useEffect(() => {
    function hidden() {if (document.hidden) stopAudio();}
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  useEffect(() => {
    if (open) closeButton.current?.focus();
    function escape(event: KeyboardEvent) {if (event.key === "Escape" && open && !demo) close();}
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, demo]);
  useEffect(() => {
    if (!open || tab !== "progress" || !courseId || demo) return;
    const controller = new AbortController(); progressRequest.current?.abort(); progressRequest.current = controller;
    setProgressLoading(true); setProgressError(false);
    api<StudyOverview>(`v1/study/overview?course_id=${encodeURIComponent(courseId)}`,{signal:controller.signal})
      .then(data => {if (!controller.signal.aborted) setOverview(data);})
      .catch(() => {if (!controller.signal.aborted) setProgressError(true);})
      .finally(() => {if (!controller.signal.aborted) setProgressLoading(false);});
    return () => controller.abort();
  }, [open, tab, courseId, demo, refresh]);

  function speak(text: string) {
    if (!speechAvailable || document.hidden) return;
    stopAudio();
    const utterance = new SpeechSynthesisUtterance(speechText(text));
    utterance.lang = voiceLanguage;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(item => item.lang.toLowerCase() === voiceLanguage.toLowerCase()) || voices.find(item => item.lang.split("-")[0] === voiceLanguage.split("-")[0]);
    if (!voice) {setNotice("No installed voice matches this language. The written answer is still available."); return;}
    utterance.voice = voice; utterance.rate = .96;
    utterance.onstart = () => {if (alive.current) setSpeaking(true);};
    utterance.onend = () => {if (alive.current) setSpeaking(false); speech.current = null;};
    utterance.onerror = () => {if (alive.current) {setSpeaking(false); setNotice("Audio could not play. The written answer is still available.");} speech.current = null;};
    speech.current = utterance; window.speechSynthesis.speak(utterance);
  }
  function listen() {
    if (listening) {recognition.current?.stop(); return;}
    const host = window as SpeechWindow;
    const Constructor = host.SpeechRecognition || host.webkitSpeechRecognition;
    if (!Constructor) {setNotice("Voice input is unavailable in this browser. You can type your question."); return;}
    stopAudio(); setNotice("");
    const instance = new Constructor(); recognition.current = instance;
    instance.lang = voiceLanguage; instance.continuous = false; instance.interimResults = true;
    instance.onresult = event => {
      if (!alive.current || recognition.current !== instance) return;
      setDraft(Array.from(event.results).map(part => part[0].transcript).join(" ").slice(0,2000));
    };
    instance.onerror = event => {
      if (!alive.current || recognition.current !== instance) return;
      setNotice(event.error === "not-allowed" || event.error === "service-not-allowed" ? "Microphone access was denied. Allow it in browser settings or type your question." : "Voice input stopped. Check your microphone or type your question.");
    };
    instance.onend = () => {if (alive.current && recognition.current === instance) {setListening(false); recognition.current = null;}};
    try {instance.start(); setListening(true);} catch {setListening(false); recognition.current = null; setNotice("Voice input stopped. Check your microphone or type your question.");}
  }
  async function send(mode: "ask" | "mistakes" = "ask", explicit?: string) {
    const question = (explicit ?? draft).trim();
    if (busy || (mode === "ask" && !question)) return;
    const command = mode === "ask" ? voiceCommand(question) : null;
    if (command) {
      stopAudio(); setDraft("");
      if (command === "progress") setTab("progress");
      if (command === "visual") setTab("visual");
      if (command === "quiz") {if (onQuiz) {close(); onQuiz();} else setNotice("Sign in to practise with your own course.");}
      if (command === "close" && !demo) close();
      return;
    }
    if (demo) {setNotice("Sign in to ask about your own course. This playground uses an authored sample."); return;}
    if (!courseId) {setNotice("Choose a lesson and add its material first."); return;}
    stopAudio(); setBusy(true); setNotice(""); setGesture("think"); setTab("ask");
    const controller = new AbortController(); request.current = controller;
    const version = ++requestId.current;
    try {
      const data = await api<CompanionAnswer>("v1/companion/ask",{method:"POST",signal:controller.signal,headers:{"content-type":"application/json"},body:JSON.stringify({course_id:courseId,session_id:session,question,mode,video_time_seconds:Math.max(0,Math.floor(getCurrentTime?.() ?? videoSeconds)),response_language:voiceLanguage})});
      if (version !== requestId.current || !alive.current) return;
      setResult(data); setSession(data.session_id); setGesture(data.gesture); setDraft(""); onChanged?.();
      if (readAloud) speak(data.status === "no_weak_topics" ? t(data.answer) : data.answer);
    } catch (error) {
      if (version !== requestId.current || controller.signal.aborted) return;
      setNotice(errorText(error,"Could not get an answer.")); setGesture("encourage");
    } finally {if (version === requestId.current && alive.current) setBusy(false);}
  }
  function showSample() {stopAudio(); setNotice(""); setResult(demoAnswer); setGesture("explain"); setTab("visual");}
  const totals = overview ? progressTotals(overview) : null;
  const state = listening ? "listen" : busy ? "think" : gesture;
  const stateLabel = listening ? "Listening…" : busy ? "Thinking…" : speaking ? "Speaking…" : "Ready to learn";
  return <>
    {!demo && <button type="button" ref={launcher} className="lumi-launcher" aria-label={t("Open Lumi companion")} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}><LumiAvatar gesture={state} speaking={speaking}/><span>{t("Ask Lumi")}</span></button>}
    {open && <aside className={`lumi-panel ${demo ? "lumi-panel-demo" : ""}`} aria-label={t("Lumi learning companion")}>
      <header className="lumi-panel-header"><div><span className="lumi-online"/><strong>{t("Lumi")}</strong><span className="lumi-header-sub">{t("Your learning companion")}</span></div>{demo ? <a href="/login" className="lumi-text-button">{t("Sign in")}{" ↗"}</a> : <button ref={closeButton} type="button" className="lumi-close" aria-label={t("Close companion")} onClick={close}>{"×"}</button>}</header>
      <div className="lumi-panel-scroll">
        <div className="lumi-welcome"><div className="lumi-avatar-stage"><div className="lumi-orbit"/><LumiAvatar gesture={state} speaking={speaking}/></div><div><span className={`lumi-state lumi-state-${state}`} role="status">{t(stateLabel)}</span><h2>{t("A little company. A clearer concept.")}</h2><p>{demo ? t("An interactive preview. Your private courses stay private.") : courseTitle || t("Choose a lesson and add its material first.")}</p></div></div>
        <nav className="lumi-tabs" aria-label={t("Companion tools")}>{(["ask","progress","visual"] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{t(value === "ask" ? "Ask Lumi" : value === "progress" ? "My progress" : "3D board")}</button>)}</nav>
        {notice && <p className="lumi-notice" role="status">{t(notice)}</p>}
        {tab === "progress" ? <section className="lumi-progress">
          <h3>{t("Small steps, real progress.")}</h3>
          {demo ? <><p>{t("Sign in to see your actual quiz results and revision queue. No progress is invented for this demo.")}</p><div className="lumi-actions"><button type="button" onClick={() => setGesture("celebrate")}>{t("Celebrate a study break")}{" ✧"}</button></div></> : progressLoading ? <p role="status">{t("Please wait…")}</p> : progressError ? <p role="status">{t("Could not load your progress. Reopen this tab to retry.")}</p> : totals && <>
            <div className="lumi-stats">{[[totals.attempts,"Questions practised"],[totals.accuracy === null ? "—" : `${totals.accuracy}%`,"Accuracy"],[totals.notes,"Saved notes"],[totals.due,"Due for revision"]].map(([value,label]) => <div key={label}><strong>{value}</strong><span>{t(String(label))}</span></div>)}</div>
            <h4>{t("Let's work on these together")}</h4>
            {totals.weak.length ? totals.weak.slice(0,4).map(topic => <button type="button" className="lumi-topic" key={topic.title} disabled={busy} onClick={() => void send("ask",`Explain ${topic.title} simply using my course. Explain a common confusion without assuming which answer I submitted.`)}><span>{topic.title}</span><span>{t("Practise")}{" ↗"}</span></button>) : <p>{t("No weak topics yet. Try a quiz to discover your next step.")}</p>}
            <div className="lumi-actions"><button type="button" onClick={() => {setGesture("celebrate");}}>{t("Celebrate a study break")}{" ✧"}</button>{onQuiz && <button type="button" onClick={() => {close(); onQuiz();}}>{t("Quiz me")}{" ↗"}</button>}</div>
          </>}
        </section> : <>
          {tab === "visual" && (result?.visual ? <ConceptBoard key={`${result.session_id}-${result.visual.title}`} visual={result.visual}/> : <div className="lumi-empty-board"><span>{"◈"}</span><h3>{t("Make an idea tangible.")}</h3><p>{t("Ask about your lesson. When evidence supports it, Lumi builds a rotatable concept map, comparison, or sequence.")}</p>{demo && <button type="button" className="button-primary" onClick={showSample}>{t("Try a sample explanation")}</button>}</div>)}
          {tab === "ask" && !result && <div className="lumi-intro"><p>{t("Ask a doubt, unpack an idea, or revisit a weak topic. Lumi uses the same evidence as your course guide.")}</p><div className="lumi-actions">{demo ? <button type="button" onClick={showSample}>{t("Try a sample explanation")}{" ↗"}</button> : <><button type="button" disabled={busy || !courseId} onClick={() => void send("ask","Summarize what I have learned so far")}>{t("Summarize so far")}</button><button type="button" disabled={busy || !courseId} onClick={() => void send("mistakes")}>{t("Help with my mistakes")}</button></>}</div></div>}
          {result && <article className="lumi-answer" aria-live="polite"><div className="lumi-answer-label"><span>{demo ? t("Authored sample · not live AI") : result.refusal_reason ? t("More evidence needed") : result.citations.length ? t("Grounded in your course") : t("Your study activity")}</span><div>{speechAvailable && <button type="button" className="lumi-text-button" onClick={() => speaking ? stopAudio() : speak(result.status ? t(result.answer) : result.answer)}>{t(speaking ? "Stop speaking" : "Read aloud")}</button>}{result.visual && tab === "ask" && <button type="button" className="lumi-text-button" onClick={() => setTab("visual")}>{t("Show 3D board")}{" ↗"}</button>}</div></div><p dir="auto">{result.status ? t(result.answer) : result.answer}</p>{result.citations.length > 0 && <EvidenceSources citations={result.citations} onSeek={onSeek} videoUrl={videoUrl}/>} {result.visual_status === "unavailable" && <small>{t("The visual could not be verified. The sourced answer is available above.")}</small>}</article>}
        </>}
      </div>
      <form className="lumi-composer" onSubmit={(event: FormEvent) => {event.preventDefault(); void send();}}>
        <label className="lumi-input-label" htmlFor={demo ? "lumi-demo-question" : "lumi-question"}>{t("Your question or voice command")}</label>
        <div className="lumi-input-row"><textarea id={demo ? "lumi-demo-question" : "lumi-question"} value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} rows={2} placeholder={t("What would you like to understand?")} disabled={busy}/><button type="button" className={`lumi-mic ${listening ? "lumi-mic-active" : ""}`} disabled={busy || !voiceAvailable} aria-label={t(listening ? "Stop listening" : "Dictate a question")} title={t(listening ? "Stop listening" : "Dictate a question")} onClick={listen}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6"/></svg></button><button type="submit" className="lumi-send" disabled={busy || listening || !draft.trim()} aria-label={t("Send question")}>{"↑"}</button></div>
        <div className="lumi-voice-options"><label><input type="checkbox" checked={readAloud} disabled={!speechAvailable} onChange={e => {setReadAloud(e.target.checked); if (!e.target.checked) stopAudio();}}/>{t("Speak answers")}</label><label>{t("Voice language")}<select aria-label={t("Voice language")} value={voiceLanguage} onChange={e => setVoiceOverride(e.target.value)}>{ANSWER_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.native}</option>)}</select></label></div>
        <small>{t(voiceAvailable ? "Tap the microphone, then review and send. Your browser may process audio online." : "Voice input is unavailable in this browser. You can type your question.")}</small>
        <details className="lumi-command-help"><summary>{t("Voice commands & privacy")}</summary><p>{t("Voice commands: show my progress, show the visual, start a quiz, stop speaking. Review the transcript and press Send to run a command. Other questions can use your selected answer language. No continuous listening.")}</p><p>{t("Speech recognition and installed voices depend on your browser, device, and language. Audio is not stored by Learnflow; submitted text uses your course guide.")}</p></details>
      </form>
    </aside>}
  </>;
}
