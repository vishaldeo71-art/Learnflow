"""Timestamp-gated hybrid retrieval, reranking and citation formatting."""

import re
from typing import Any

from .embeddings import EmbeddingProvider, tokens
from .source_quality import informative


def is_overview_question(question: str) -> bool:
    normalized = re.sub(r"[^a-z0-9 ]", "", question.lower()).strip()
    return bool(re.fullmatch(
        r"(?:what is (?:this|the) (?:lesson|course|lecture|video) about|"
        r"(?:give me |show me )?(?:an? )?(?:overview|summary) of (?:this|the) (?:lesson|course|lecture|video)|"
        r"what (?:have i learned|has been covered) so far)", normalized
    ))


def format_time(seconds: int | None) -> str:
    seconds = max(0, int(seconds or 0))
    return f"{seconds // 3600}:{seconds // 60 % 60:02d}:{seconds % 60:02d}" if seconds >= 3600 else f"{seconds // 60:02d}:{seconds % 60:02d}"


def citation_for(chunk: dict[str, Any]) -> dict[str, Any]:
    kind = chunk.get("source_type")
    if kind == "video":
        start = chunk.get("start_time")
        end = chunk.get("end_time")
        if start is None:
            # Never turn missing transcript timing into a false 00:00 citation.
            label = f"{chunk.get('resource_name') or 'Video'} · timestamp unavailable"
            seek_seconds = None
        else:
            prefix = "AI video notes (approximate)" if (chunk.get("resource_name") or "").startswith("AI video notes") else "Video"
            label = f"{prefix} {format_time(start)}-{format_time(end)}"
            seek_seconds = int(start)
    elif kind == "pdf":
        page = chunk.get("page_number")
        label = f"{chunk.get('resource_name', 'PDF')} · page {page}"
        seek_seconds = None
    elif kind == "ppt":
        slide = chunk.get("slide_number")
        label = f"{chunk.get('resource_name', 'Slides')} · slide {slide}"
        seek_seconds = None
    else:
        label = chunk.get("resource_name", "Course notes")
        seek_seconds = None
    return {
        "label": label, "source_type": kind, "type": kind,
        "source_id": str(chunk.get("resource_id") or chunk.get("source_id") or ""),
        "chunk_id": str(chunk.get("id") or ""),
        "seek_seconds": seek_seconds,
        "start_seconds": chunk.get("start_time"), "end_seconds": chunk.get("end_time"),
        "page": chunk.get("page_number"), "slide": chunk.get("slide_number"),
        "resource_name": chunk.get("resource_name"), "quote": str(chunk.get("content", ""))[:700],
    }


class Retriever:
    def __init__(self, store, embedder: EmbeddingProvider, limit: int = 6):
        self.store = store
        self.embedder = embedder
        self.limit = limit

    async def retrieve(self, course_id: str, query: str, current_time: int) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        vector = await self.embedder.embed(query)
        # Store search applies source_type != video OR end_time <= current_time in SQL.
        # Future transcript payload is never returned to the application prompt.
        matches = await self.store.search_chunks(course_id, query, vector, current_time, 24)
        reranked = self._rerank(query, matches)[: self.limit]
        future = None if reranked else await self.store.future_match(course_id, query, vector, current_time)
        semantic = getattr(getattr(self.embedder, "settings", None), "embedding_provider", "local") == "gemini"
        if future and semantic and float(future.get("score", 0)) < 0.65:
            future = None
        return reranked, future

    async def covered(self, course_id: str, current_time: int, limit: int = 8) -> list[dict[str, Any]]:
        rows = await self.store.study_chunks(course_id, current_time)
        unique = {}
        for row in rows:
            text = row.get("content", "")
            if informative(text):
                unique.setdefault(re.sub(r"\s+", " ", text.casefold()).strip(), row)
        useful = sorted(unique.values(), key=lambda row: row.get("end_time") or 0)
        limit = min(limit, 10)
        if len(useful) <= limit:
            return useful
        recent_count = limit // 2
        earlier = useful[:-recent_count]
        sample_count = limit - recent_count
        return [earlier[int(index * len(earlier) / sample_count)] for index in range(sample_count)] + useful[-recent_count:]

    def _rerank(self, query: str, chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        query_terms = set(tokens(query))
        semantic = getattr(getattr(self.embedder, "settings", None), "embedding_provider", "local") == "gemini"
        ranked = []
        for chunk in chunks:
            if not informative(chunk.get("content", "")):
                continue
            body_terms = set(tokens(chunk.get("content", "")))
            overlap = len(query_terms & body_terms) / max(1, len(query_terms))
            if semantic and "semantic_score" in chunk:
                similarity = float(chunk["semantic_score"])
                if similarity < 0.53:
                    continue
                score = 0.9 * similarity + 0.1 * overlap
            else:
                score = 0.58 * float(chunk.get("score", 0.0)) + 0.42 * overlap
            ranked.append(({**chunk, "score": score}, score))
        ranked.sort(key=lambda pair: pair[1], reverse=True)
        return [item for item, _ in ranked]


def citation_list(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    citations = []
    seen = set()
    for chunk in chunks:
        citation = citation_for(chunk)
        if citation["label"] not in seen:
            seen.add(citation["label"])
            citations.append(citation)
    return citations


def context_for(chunks: list[dict[str, Any]], max_chars: int = 9000) -> str:
    blocks = []
    size = 0
    for index, chunk in enumerate(chunks, start=1):
        citation = citation_for(chunk)["label"]
        block = f"[S{index}] {citation}: {chunk['content']}"
        if size + len(block) > max_chars:
            break
        blocks.append(block)
        size += len(block)
    return "\n\n".join(blocks)
