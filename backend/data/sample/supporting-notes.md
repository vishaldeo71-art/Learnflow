# Retrieval augmented generation

Retrieval augmented generation (RAG) grounds a model response in a small set of passages retrieved from a knowledge source. A typical flow embeds the query, retrieves candidates, reranks them and gives only the selected evidence to the model.

## Why hybrid retrieval?

Keyword search is useful for exact phrases, acronyms and identifiers. Vector search is useful for matching meaning across paraphrases. Rank fusion combines their ranked results.

## Timestamp safety

For a learner position T, include a transcript chunk only when `end_time <= T`. Apply this condition in the retrieval query itself. Supporting course documents are permitted context. If an answer depends only on a future lecture passage, say that it has not been covered yet.

