"use client";
import { useState } from "react";
import { useI18n } from "./I18nProvider";
import { api } from "../lib/api";
export type Evidence = {
  label: string;
  source_type: string;
  seek_seconds: number | null;
  resource_name: string;
  source_id?: string;
  chunk_id?: string;
  source_label?: string;
  resource_id?: string;
  page_number?: number;
  slide_number?: number;
  excerpt?: string;
  approximate?: boolean;
};
export default function EvidenceSources({
  citations,
  onSeek,
  videoUrl,
}: {
  citations: Evidence[];
  onSeek?: (seconds: number) => void;
  videoUrl?: string | null;
}) {
  const { t, citationLabel } = useI18n();
  const [originals, setOriginals] = useState<
    Record<string, { resource_id: string; original_available: boolean }>
  >({});
  const [error, setError] = useState(false);
  async function findOriginal(source: Evidence) {
    const sourceId = source.chunk_id || source.source_id;
    if (!sourceId || originals[sourceId]) return;
    try {
      const result = await api<{
        resource_id: string;
        original_available: boolean;
      }>(`v1/sources/${sourceId}`);
      setOriginals((values) => ({ ...values, [sourceId]: result }));
      setError(false);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="evidence-list">
      {citations.map((source, index) => (
        <details
          key={source.chunk_id || source.source_id || source.label}
          className="evidence-source"
          onToggle={(e) => {
            if (e.currentTarget.open && source.seek_seconds === null)
              void findOriginal(source);
          }}
        >
          <summary>
            {source.source_label ? `[${source.source_label}] ` : ""}
            {citationLabel(source.label)}
          </summary>
          <div>
            {source.approximate && (
              <small>
                {t(
                  "AI video notes are approximate. Check the original video for exact wording.",
                )}
              </small>
            )}
            <blockquote>
              {source.excerpt || t("Open the source to review this evidence.")}
            </blockquote>
            <div className="study-actions">
              {source.seek_seconds !== null && onSeek && (
                <button
                  className="text-button"
                  onClick={() => onSeek(source.seek_seconds!)}
                >
                  {t("Go to this moment")}
                </button>
              )}
              {videoUrl && source.seek_seconds !== null && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  className="text-button"
                  href={`${videoUrl}${videoUrl.includes("?") ? "&" : "?"}t=${source.seek_seconds}s`}
                >
                  {t("Open original video")}
                </a>
              )}
              {(source.chunk_id || source.source_id) &&
                originals[source.chunk_id || source.source_id || ""]
                  ?.original_available && (
                  <a
                    className="text-button"
                    target="_blank"
                    rel="noreferrer"
                    href={`/api/v1/resources/${originals[source.chunk_id || source.source_id || ""].resource_id}/file${source.page_number ? `#page=${source.page_number}` : ""}`}
                  >
                    {t(
                      source.page_number
                        ? "Open original PDF page"
                        : "Open original document",
                    )}
                  </a>
                )}
              {(source.chunk_id || source.source_id) &&
                originals[source.chunk_id || source.source_id || ""] &&
                !originals[source.chunk_id || source.source_id || ""]
                  .original_available &&
                source.seek_seconds === null && (
                  <small>
                    {t(
                      "The original file was not retained for this older material. The extracted passage is shown above.",
                    )}
                  </small>
                )}
            </div>
          </div>
        </details>
      ))}
      {error && (
        <p role="status" className="muted">
          {t("Could not open the source. Please retry.")}
        </p>
      )}
    </div>
  );
}
