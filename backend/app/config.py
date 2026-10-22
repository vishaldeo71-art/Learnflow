from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ENV, extra="ignore", case_sensitive=False)

    app_env: str = "development"
    app_api_key: str | None = None
    database_url: str | None = None
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    cors_origins: str = "http://localhost:3000"
    rate_limit_requests: int = 60
    rate_limit_window_seconds: int = 60
    max_upload_mb: int = 20

    llm_provider: str = "mock"
    llm_model: str | None = None
    openai_api_key: str | None = None
    gemini_api_key: str | None = None
    aws_region: str = "us-east-1"
    bedrock_model_id: str = "anthropic.claude-haiku-4-5-20251001-v1:0"

    embedding_provider: str = "local"
    embedding_dimensions: int = 1024
    embedding_model: str | None = None

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
