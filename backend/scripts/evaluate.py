"""Small reproducible retrieval evaluation for the included sample lesson."""

import asyncio
import csv
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.domain import Chunk
from app.embeddings import feature_embedding
from app.retrieval import Retriever
from app.storage import MemoryStore


class HashedEmbedding:
    async def embed(self, text):
        return feature_embedding(text)


async def main():
    store = MemoryStore()
    course_id = "00000000-0000-4000-8000-000000000001"
    # Evaluation corpus deliberately contains one future-only concept plus a notes answer.
    samples = [
        ("video", "An embedding represents text as a vector of numbers.", 180, 245, None, None),
        ("video", "Vector search compares question embeddings with passage embeddings.", 450, 505, None, None),
        ("video", "Hybrid retrieval combines keyword search and semantic vectors using reciprocal rank fusion.", 720, 785, None, None),
        ("video", "Reranking scores retrieved passages against the question again.", 1080, 1145, None, None),
        ("video", "Timestamp-aware retrieval keeps only chunks whose end_time is at or before the learner position.", 1500, 1565, None, None),
        ("notes", "Keyword retrieval handles exact terms. Vector retrieval matches paraphrases. Rank fusion combines the lists.", None, None, None, None),
    ]
    for index, (kind, content, start, end, page, slide) in enumerate(samples):
        store.chunks[course_id].append(Chunk(
            id=f"chunk-{index}", course_id=course_id, resource_id=f"resource-{index}", resource_name="sample-notes.md" if kind == "notes" else "sample-lesson.vtt",
            source_type=kind, content=content, embedding=feature_embedding(content), start_time=start, end_time=end, page_number=page, slide_number=slide,
        ))
    retriever = Retriever(store, HashedEmbedding())
    cases = json.loads((ROOT / "data/evaluation/cases.json").read_text())
    results = []
    for case in cases:
        started = time.perf_counter()
        matches, future = await retriever.retrieve(course_id, case["question"], case["video_time_seconds"])
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        expected = case["expected"]
        if expected == "future_content_refusal":
            observed = "future_content_refusal" if future and not matches else "answer_with_citation"
        elif expected == "unsupported_refusal":
            observed = "unsupported_refusal" if not matches and not future else "answer_with_citation"
        elif expected == "boundary_chunk_available_only_at_end_time":
            observed = "boundary_chunk_available_only_at_end_time" if any(chunk.get("end_time") == 1565 for chunk in matches) else "no_match"
        elif expected == "answer_with_document_citation":
            observed = "answer_with_document_citation" if any(chunk.get("source_type") in {"pdf", "ppt", "notes"} for chunk in matches) else "unsupported_refusal"
        elif expected == "answer_with_video_citation":
            observed = "answer_with_video_citation" if any(chunk.get("source_type") == "video" for chunk in matches) else "unsupported_refusal"
        else:
            observed = "answer_with_citation" if matches else "unsupported_refusal"
        future_leak = any(chunk.get("source_type") == "video" and (chunk.get("end_time") or 0) > case["video_time_seconds"] for chunk in matches)
        citation_correct = bool(matches) and all(chunk.get("source_type") in {"video", "notes"} for chunk in matches)
        results.append({"run_id":"sample-local", "case_id":case["id"], "expected":expected, "observed":observed,
                        "retrieval_hit":bool(matches), "citation_correct":citation_correct, "future_leak":future_leak,
                        "latency_ms":elapsed_ms, "input_tokens":"", "output_tokens":"", "estimated_cost_usd":"",
                        "notes":f"future_match={bool(future)}; retrieved={len(matches)}"})
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data/evaluation/results_local.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(results[0]))
        writer.writeheader()
        writer.writerows(results)
    print(json.dumps({"cases": len(results), "passed": sum(row["expected"] == row["observed"] and not row["future_leak"] for row in results),
                      "future_leaks": sum(row["future_leak"] for row in results), "results": str(out)}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
