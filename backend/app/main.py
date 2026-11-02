import asyncio
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    func,
    select,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env", extra="ignore"
    )
    gemini_api_key: str = ""
    model_a: str = Field(default="gemini-3.5-flash-lite", min_length=1, max_length=200)
    model_b: str = Field(default="gemini-3.1-flash-lite", min_length=1, max_length=200)
    database_url: str = "sqlite:///./comparisons.db"
    cors_origins: list[str] = ["http://localhost:5173"]

    @field_validator("model_a", "model_b", "gemini_api_key", mode="before")
    @classmethod
    def strip_configuration(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def distinct_models(self):
        if self.model_a == self.model_b:
            raise ValueError("MODEL_A and MODEL_B must be distinct")
        return self


class Base(DeclarativeBase):
    pass


class Comparison(Base):
    __tablename__ = "comparisons"
    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    browser_id: Mapped[str] = mapped_column(String(36), index=True)
    prompt: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Response(Base):
    __tablename__ = "responses"
    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    comparison_id: Mapped[str] = mapped_column(ForeignKey("comparisons.id"), index=True)
    model: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int]


class Vote(Base):
    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("comparison_id", "browser_id"),)
    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    comparison_id: Mapped[str] = mapped_column(ForeignKey("comparisons.id"))
    response_id: Mapped[str] = mapped_column(ForeignKey("responses.id"))
    browser_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class CompareInput(BaseModel):
    browser_id: UUID
    prompt: str = Field(min_length=1, max_length=12000)

    @field_validator("prompt")
    @classmethod
    def clean_prompt(cls, value):
        if not value.strip():
            raise ValueError("Prompt cannot be blank")
        return value.strip()


class VoteInput(BaseModel):
    browser_id: UUID
    response_id: UUID


async def generate(settings: Settings, model: str, prompt: str):
    start = time.perf_counter()
    text, error = "", None
    try:
        async with genai.Client(api_key=settings.gemini_api_key).aio as client:
            result = await asyncio.wait_for(
                client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(max_output_tokens=2048),
                ),
                timeout=60,
            )
            text = result.text or ""
            if not text.strip():
                error = "The model returned no text. Try a different prompt."
    except asyncio.TimeoutError:
        error = "Model request timed out. Please try again."
    except Exception:
        # Provider exceptions can contain credentials or request contents.
        error = (
            "Model request failed. Check backend credentials, model access, and quota."
        )
    return dict(
        model=model,
        text=text,
        error=error,
        latency_ms=round((time.perf_counter() - start) * 1000),
    )


def create_app(settings: Settings | None = None, generator=generate):
    settings = settings or Settings()
    url = settings.database_url
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
        pool_pre_ping=True,
    )
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def sqlite_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

    sessions = sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(app):
        try:
            Base.metadata.create_all(engine)
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="LLM Comparison Platform", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    def database():
        with sessions() as session:
            yield session

    def serialize(row: Comparison, db: Session):
        responses = db.scalars(
            select(Response)
            .where(Response.comparison_id == row.id)
            .order_by(Response.model)
        ).all()
        vote = db.scalar(
            select(Vote).where(
                Vote.comparison_id == row.id, Vote.browser_id == row.browser_id
            )
        )
        # SQLite drops timezone information even for DateTime(timezone=True).
        created_at = row.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        return dict(
            id=row.id,
            prompt=row.prompt,
            created_at=created_at,
            responses=[
                dict(
                    id=r.id,
                    model=r.model,
                    text=r.text,
                    error=r.error,
                    latency_ms=r.latency_ms,
                )
                for r in responses
            ],
            voted_response_id=vote.response_id if vote else None,
        )

    @app.get("/api/health")
    def health():
        return {"status": "ok", "configured": bool(settings.gemini_api_key)}

    @app.post("/api/comparisons", status_code=201)
    async def compare(body: CompareInput, db: Session = Depends(database)):
        if not settings.gemini_api_key:
            raise HTTPException(
                503, "Set GEMINI_API_KEY in backend/.env before comparing models."
            )
        results = await asyncio.gather(
            *(
                generator(settings, model, body.prompt)
                for model in [settings.model_a, settings.model_b]
            )
        )
        row = Comparison(browser_id=str(body.browser_id), prompt=body.prompt)
        db.add(row)
        db.flush()
        db.add_all([Response(comparison_id=row.id, **result) for result in results])
        db.commit()
        return serialize(row, db)

    @app.get("/api/history")
    def history(
        browser_id: UUID,
        limit: int = 20,
        offset: int = 0,
        db: Session = Depends(database),
    ):
        if not 1 <= limit <= 100 or offset < 0:
            raise HTTPException(422, "Invalid pagination")
        rows = db.scalars(
            select(Comparison)
            .where(Comparison.browser_id == str(browser_id))
            .order_by(Comparison.created_at.desc(), Comparison.id)
            .offset(offset)
            .limit(limit)
        ).all()
        return [serialize(row, db) for row in rows]

    @app.post("/api/comparisons/{comparison_id}/votes", status_code=201)
    def vote(comparison_id: UUID, body: VoteInput, db: Session = Depends(database)):
        row = db.get(Comparison, str(comparison_id))
        if not row or row.browser_id != str(body.browser_id):
            raise HTTPException(404, "Comparison not found")
        responses = db.scalars(
            select(Response).where(Response.comparison_id == row.id)
        ).all()
        if len(responses) != 2 or any(r.error or not r.text for r in responses):
            raise HTTPException(400, "Both models must return text before voting")
        if str(body.response_id) not in [r.id for r in responses]:
            raise HTTPException(400, "Response does not belong to this comparison")
        db.add(
            Vote(
                comparison_id=row.id,
                response_id=str(body.response_id),
                browser_id=str(body.browser_id),
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "You have already voted on this comparison")
        return serialize(row, db)

    @app.get("/api/leaderboard")
    def leaderboard(db: Session = Depends(database)):
        counts = dict(
            db.execute(
                select(Response.model, func.count(Vote.id))
                .join(Vote, Vote.response_id == Response.id)
                .group_by(Response.model)
            ).all()
        )
        models = set(db.scalars(select(Response.model).distinct()).all()) | {
            settings.model_a,
            settings.model_b,
        }
        total = sum(counts.values())
        return {
            "total_votes": total,
            "models": sorted(
                [
                    {
                        "model": m,
                        "wins": counts.get(m, 0),
                        "vote_percentage": (
                            round(counts.get(m, 0) / total * 100, 1) if total else 0
                        ),
                    }
                    for m in models
                ],
                key=lambda r: (-r["wins"], r["model"]),
            ),
        }

    return app


app = create_app()
