"""Fixed-width embeddings shared by retrieval and pgvector (1024 dimensions by default)."""

import asyncio
import hashlib
import math
import re

from .config import Settings

TOKEN_RE = re.compile(r"[a-zA-Z0-9_+#]{2,}")
STOP_WORDS = {
    "a", "about", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
    "for", "from", "how", "i", "in", "is", "it", "of", "on", "or", "that", "the", "this",
    "to", "was", "what", "when", "where", "which", "who", "why", "with",
}


def tokens(text: str) -> list[str]:
    return [token for raw in TOKEN_RE.findall(text) if (token := raw.lower()) not in STOP_WORDS]


def feature_embedding(text: str, dimensions: int = 1024) -> list[float]:
    """Deterministic feature hashing for offline/demo retrieval, not a semantic model."""
    vector = [0.0] * dimensions
    for token in tokens(text):
        raw = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        slot = int.from_bytes(raw[:4], "little") % dimensions
        sign = 1.0 if raw[4] & 1 else -1.0
        vector[slot] += sign
    norm = math.sqrt(sum(item * item for item in vector)) or 1.0
    return [item / norm for item in vector]


class EmbeddingProvider:
    def __init__(self, settings: Settings):
        self.settings = settings
        if settings.embedding_dimensions != 1024:
            raise ValueError("The supplied Supabase migration uses vector(1024); keep EMBEDDING_DIMENSIONS=1024.")

    async def embed(self, text: str) -> list[float]:
        provider = self.settings.embedding_provider.lower()
        if provider == "local":
            return feature_embedding(text, self.settings.embedding_dimensions)
        if provider == "openai":
            if not self.settings.openai_api_key:
                raise RuntimeError("OPENAI_API_KEY is required for OpenAI embeddings.")
            from openai import AsyncOpenAI

            client = AsyncOpenAI(api_key=self.settings.openai_api_key)
            response = await client.embeddings.create(
                model=self.settings.embedding_model or "text-embedding-3-small",
                input=text,
                dimensions=self.settings.embedding_dimensions,
            )
            return response.data[0].embedding
        if provider == "gemini":
            return (await self._gemini_batch([text], "RETRIEVAL_QUERY"))[0]
        if provider == "bedrock":
            import json
            import boto3

            def invoke():
                client = boto3.client("bedrock-runtime", region_name=self.settings.aws_region)
                response = client.invoke_model(
                    modelId=self.settings.embedding_model or "amazon.titan-embed-text-v2:0",
                    body=json.dumps({"inputText": text, "dimensions": self.settings.embedding_dimensions}),
                    contentType="application/json",
                    accept="application/json",
                )
                return json.loads(response["body"].read())["embedding"]

            return await asyncio.to_thread(invoke)
        raise ValueError(f"Unsupported EMBEDDING_PROVIDER: {provider}")

    async def embed_many(self, texts: list[str]) -> list[list[float]]:
        if self.settings.embedding_provider.lower() != "gemini":
            return [await self.embed(text) for text in texts]
        # gemini-embedding-001 returns one vector per input string; batching keeps
        # long, multilingual caption imports practical without changing dimensions.
        vectors = []
        for start in range(0, len(texts), 64):
            vectors.extend(await self._gemini_batch(texts[start:start + 64], "RETRIEVAL_DOCUMENT"))
        return vectors

    async def _gemini_batch(self, texts: list[str], task_type: str) -> list[list[float]]:
        if not self.settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is required for Gemini embeddings.")
        from google import genai
        from google.genai import types

        def run():
            client = genai.Client(api_key=self.settings.gemini_api_key, http_options=types.HttpOptions(timeout=60000))
            try:
                response = client.models.embed_content(
                    model=self.settings.embedding_model or "gemini-embedding-001", contents=texts,
                    config=types.EmbedContentConfig(output_dimensionality=1024, task_type=task_type),
                )
                if len(response.embeddings or []) != len(texts):
                    raise RuntimeError("Embedding provider returned an unexpected number of vectors.")
                output = []
                for item in response.embeddings:
                    vector = list(item.values)
                    if len(vector) != self.settings.embedding_dimensions or not all(math.isfinite(value) for value in vector):
                        raise RuntimeError("Embedding provider returned an invalid vector.")
                    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
                    output.append([value / norm for value in vector])
                return output
            finally:
                client.close()
        return await asyncio.to_thread(run)
