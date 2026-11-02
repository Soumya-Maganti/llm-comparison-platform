"""Test-only model provider. Never imported by the production application."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from app.main import Settings, create_app


async def fake(settings, model, prompt):
    await asyncio.sleep(0.1)
    return dict(
        model=model,
        text=f"Test response from {model}: {prompt}",
        error=None,
        latency_ms=100,
    )


temporary_database = TemporaryDirectory(prefix="llm-comparison-e2e-")
database_file = Path(temporary_database.name) / "test.db"
app = create_app(
    Settings(
        _env_file=None,
        gemini_api_key="test-only",
        database_url=f"sqlite:///{database_file.as_posix()}",
    ),
    fake,
)
original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    try:
        async with original_lifespan(application):
            yield
    finally:
        temporary_database.cleanup()


app.router.lifespan_context = lifespan
