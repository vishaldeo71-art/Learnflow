# Evaluation plan

The challenge calls for checks on past questions, future questions, PDF/PPT answers, unsupported queries, follow-ups and citation support. Included cases are in `backend/data/evaluation/cases.json`; `results_template.csv` has fields for retrieval, citations, leakage, latency and cost.

## Run local mechanism checks

From `backend/`:

```bash
python -m unittest discover -s tests -v
python scripts/evaluate.py
```

The script emits deterministic sample retrieval results in `data/evaluation/results_local.csv`. It checks the hard boundary and future refusal path; local feature hashing is not a semantic-quality benchmark.

## Hosted evaluation protocol

1. Prepare 20–50 questions with expert-labeled expected passage IDs and cite ranges/pages/slides.
2. Run each question at its intended video time with a fresh conversation and with a follow-up context.
3. Record retrieval hit@6, source citation correctness, timestamp leakage, unsupported answer rate, response latency, provider/model, token counts and estimated cost.
4. Manually inspect every generated answer and its cited evidence. Report unanswered items and judge correctness; don't count refusal as an answer failure when the source is absent or future-only.
5. Repeat timestamp checks at `end_time - 1`, `end_time`, and `end_time + 1` for boundary behavior.

Definitions: `retrieval_hit` means a labeled supporting chunk appears in the selected context; `citation_correct` means each citation points to a supporting source; `future_leak` is any future transcript chunk entering model context or answer; hallucination rate counts factual claims without source support. Use the CSV template for results and preserve model/version/date information with every run.

