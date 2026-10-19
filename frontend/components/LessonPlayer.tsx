"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { resolvePlayhead } from "../lib/playhead";
import { parseVideoSource } from "../lib/video-source";

type YTPlayer = { getCurrentTime(): number; getDuration(): number; seekTo(seconds: number, allowSeekAhead: boolean): void; destroy(): void };
type YTApi = { Player: new (element: HTMLElement, options: {
  videoId: string; width: string; height: string; playerVars: Record<string, string | number>;
  events: { onReady(event: { target: YTPlayer }): void; onError(event: { data: number }): void };
}) => YTPlayer };
declare global { interface Window { YT?: YTApi; onYouTubeIframeAPIReady?: () => void } }
let apiPromise: Promise<YTApi> | undefined;

function loadYouTube(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => { script.remove(); reject(new Error("YouTube did not load. Check your connection or browser content blocker.")); }, 15000);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error("YouTube could not load. Check your connection or content blocker.")); };
    document.head.appendChild(script);
  }).catch((error) => { apiPromise = undefined; throw error; });
  return apiPromise;
}

export type LessonPlayerHandle = { seekTo(seconds: number): void; getCurrentTime(): number | null };
type Props = { url: string; initialTime: number; onTimeChange(seconds: number): void; onDurationChange(seconds: number): void };

const LessonPlayer = forwardRef<LessonPlayerHandle, Props>(function LessonPlayer({ url, initialTime, onTimeChange, onDurationChange }, ref) {
  const source = parseVideoSource(url);
  const youtubeId = source.kind === "youtube" ? source.id : null;
  const host = useRef<HTMLDivElement>(null);
  const native = useRef<HTMLVideoElement>(null);
  const youtube = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const pendingSeek = useRef(initialTime);
  const seekDeadline = useRef(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(url));

  useImperativeHandle(ref, () => ({
    seekTo(seconds) {
      pendingSeek.current = seconds;
      seekDeadline.current = Date.now() + 5000;
      if (youtube.current && ready.current) youtube.current.seekTo(seconds, true);
      else if (native.current && native.current.readyState >= 1) native.current.currentTime = seconds;
    },
    getCurrentTime() {
      if (youtube.current && ready.current) return resolvePlayhead(youtube.current.getCurrentTime(), pendingSeek.current, seekDeadline.current);
      if (native.current && native.current.readyState >= 1) return Math.floor(native.current.currentTime);
      return null;
    },
  }), []);

  useEffect(() => {
    if (!youtubeId || !host.current) return;
    let disposed = false;
    let player: YTPlayer | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const node = document.createElement("div");
    host.current.replaceChildren(node);
    loadYouTube().then((YT) => {
      if (disposed) return;
      player = new YT.Player(node, {
        videoId: youtubeId, width: "100%", height: "100%",
        playerVars: { playsinline: 1, origin: window.location.origin, start: pendingSeek.current },
        events: {
          onReady({ target }) {
            if (disposed) return;
            ready.current = true;
            setLoading(false);
            if (pendingSeek.current) target.seekTo(pendingSeek.current, true);
            const update = () => {
              const time = target.getCurrentTime();
              const duration = target.getDuration();
              const resolved = resolvePlayhead(time, pendingSeek.current, seekDeadline.current);
              if (resolved !== null) {
                if (Math.abs(time - pendingSeek.current) <= 2) seekDeadline.current = 0;
                onTimeChange(resolved);
              }
              if (Number.isFinite(duration) && duration > 0) onDurationChange(Math.floor(duration));
            };
            update();
            poll = setInterval(update, 500);
          },
          onError({ data }) {
            if (disposed) return;
            setLoading(false);
            setError([101, 150].includes(data) ? "The video owner has disabled playback on other websites. Choose an embeddable video or a direct MP4 link." : data === 100 ? "This YouTube video is unavailable or private." : "YouTube could not play this video. Check the link, your connection, and browser content blockers.");
          },
        },
      });
      youtube.current = player;
    }).catch((failure: Error) => { if (!disposed) { setLoading(false); setError(failure.message); } });
    return () => { disposed = true; ready.current = false; if (poll) clearInterval(poll); player?.destroy(); youtube.current = null; };
  }, [youtubeId, onTimeChange, onDurationChange]);

  const message = source.kind === "invalid" ? source.message : error;
  return <div className="video-stage">
    {source.kind === "youtube" && <div className="youtube-player" ref={host} />}
    {source.kind === "file" && <video ref={native} src={source.url} controls playsInline aria-label="Course video player"
      onLoadedMetadata={(event) => { setLoading(false); const video = event.currentTarget; if (Number.isFinite(video.duration)) onDurationChange(Math.floor(video.duration)); video.currentTime = pendingSeek.current; }}
      onTimeUpdate={(event) => onTimeChange(Math.floor(event.currentTarget.currentTime))}
      onError={() => { setLoading(false); setError("This link is not a playable video file. Use a YouTube link or a direct MP4/WebM URL."); }} />}
    {source.kind === "empty" && <div className="video-empty"><span className="play-orb">▶</span><strong>Sample transcript demo</strong><span>Use the timeline without a video, or load a YouTube or direct video link below.</span></div>}
    {loading && !message && source.kind !== "empty" && <div className="player-feedback">Loading video…</div>}
    {message && <div className="player-feedback" role="alert">{message}</div>}
  </div>;
});
export default LessonPlayer;
