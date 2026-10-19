export type VideoSource = { kind: "empty" } | { kind: "youtube"; id: string } | { kind: "file"; url: string } | { kind: "invalid"; message: string };

export function parseVideoSource(value: string): VideoSource {
  if (!value.trim()) return { kind: "empty" };
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol)) throw new Error();
    const host = url.hostname.toLowerCase();
    const youtube = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host);
    if (youtube || host === "youtu.be") {
      const parts = url.pathname.split("/").filter(Boolean);
      const id = host === "youtu.be" ? parts[0] : url.pathname === "/watch" ? url.searchParams.get("v") : ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : null;
      return id && /^[\w-]{11}$/.test(id) ? { kind: "youtube", id } : { kind: "invalid", message: "Use a YouTube link to an individual video, such as youtube.com/watch?v=…" };
    }
    return { kind: "file", url: url.href };
  } catch {
    return { kind: "invalid", message: "Enter a full https:// YouTube or direct video-file URL." };
  }
}
