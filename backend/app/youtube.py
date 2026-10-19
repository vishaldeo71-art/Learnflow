"""Fetch public YouTube captions without downloading video or accepting arbitrary URLs."""
import math
import re
from urllib.parse import parse_qs, urlparse

import requests
from youtube_transcript_api import YouTubeTranscriptApi


class CaptionError(ValueError):
    pass


def video_id_from_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise CaptionError("Enter a valid YouTube video link.")
    host = (parsed.hostname or "").lower()
    parts = parsed.path.strip("/").split("/")
    if host == "youtu.be":
        video_id = parts[0]
    elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"}:
        video_id = parse_qs(parsed.query).get("v", [""])[0] if parsed.path == "/watch" else parts[1] if len(parts) == 2 and parts[0] in {"embed", "shorts", "live"} else ""
    else:
        raise CaptionError("Automatic captions support YouTube video links only.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise CaptionError("Use a YouTube video link, not a playlist-only link.")
    return video_id


class TimeoutSession(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", (5, 12))
        return super().request(method, url, **kwargs)


def caption_rows(snippets):
    """Group short captions; round ends UP so fractional future content never leaks."""
    rows = []
    current = None
    total = 0
    for item in snippets:
        start, duration = float(item.start), float(item.duration)
        text = re.sub(r"\s+", " ", item.text).strip()
        if not text:
            continue
        if not math.isfinite(start) or not math.isfinite(duration) or start < 0 or duration < 0 or start + duration > 86400:
            raise CaptionError("This transcript contains invalid or unsupported timestamps.")
        total += len(text)
        if total > 1_000_000 or len(rows) > 5000:
            raise CaptionError("This video is too large to import. Try a shorter lesson.")
        end = math.ceil(start + duration)
        start = math.floor(start)
        if current and (end - current["start"] > 20 or len(current["text"]) + len(text) > 1000):
            rows.append(current)
            current = None
        if current:
            current["text"] += " " + text
            current["end"] = max(current["end"], end)
        else:
            current = {"start": start, "end": end, "text": text}
    if current:
        rows.append(current)
    if not rows:
        raise CaptionError("This video has no readable captions.")
    return rows


def fetch_captions(video_id: str):
    canonical_url = f"https://www.youtube.com/watch?v={video_id}"
    with TimeoutSession() as session:
        try:
            tracks = list(YouTubeTranscriptApi(http_client=session).list(video_id))
            if not tracks:
                raise CaptionError("This video has no captions. Upload a transcript under Supporting materials.")
            # Prefer English, then Hindi, then any available original language; manual over generated.
            tracks.sort(key=lambda track: ({"en": 0, "hi": 1}.get(track.language_code.split("-")[0], 2), track.is_generated))
            transcript = tracks[0].fetch()
            rows = caption_rows(transcript)
        except CaptionError:
            raise
        except Exception as exc:
            name = type(exc).__name__
            if name in {"RequestBlocked", "IpBlocked"}:
                message = "YouTube blocked caption access from this server. Retry later or upload a transcript. No unrelated course material will be used."
            elif name in {"TranscriptsDisabled", "NoTranscriptFound", "VideoUnavailable", "VideoUnplayable", "AgeRestricted"}:
                message = "Captions are unavailable for this video. Try another captioned video or upload a transcript."
            else:
                message = "Could not retrieve YouTube captions. Check the connection and retry, or upload a transcript."
            raise CaptionError(message) from exc
        title = f"YouTube lesson · {video_id}"
        try:
            response = session.get("https://www.youtube.com/oembed", params={"url": canonical_url, "format": "json"}, timeout=5)
            response.raise_for_status()
            title = str(response.json().get("title") or title)[:160]
        except (requests.RequestException, ValueError):
            pass
        return {"title": title, "video_url": canonical_url, "language": transcript.language, "generated": transcript.is_generated, "rows": rows}
