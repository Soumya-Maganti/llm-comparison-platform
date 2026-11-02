import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.main import (
    Base, GenerationLimit, Settings, create_app, generate,
    log_provider_failure, reserve_generation,
)


async def fake(settings, model, prompt):
    return dict(model=model, text="Answer", error=None, latency_ms=1)


def test_limits_survive_restart_and_identity_changes(tmp_path, monkeypatch):
    settings = Settings(
        _env_file=None, gemini_api_key="test-only",
        database_url=f"sqlite:///{tmp_path / 'limit.db'}",
        comparison_limit_per_minute=1, comparison_limit_per_day=2,
    )
    clock = [86400]
    monkeypatch.setattr("app.main.time.time", lambda: clock[0])
    first_id = str(uuid4())
    with TestClient(create_app(settings, fake)) as client:
        row = client.post("/api/comparisons", json={"browser_id": first_id, "prompt": "Hi"}).json()
        rejected = client.post("/api/comparisons", json={"browser_id": str(uuid4()), "prompt": "Hi"})
        assert rejected.status_code == 429
        assert rejected.headers["retry-after"] == "60"
        assert client.get("/api/history", params={"browser_id": first_id}).status_code == 200
        assert client.post(f"/api/comparisons/{row['id']}/votes", json={
            "browser_id": first_id, "response_id": row["responses"][0]["id"],
        }).status_code == 201
        assert client.get("/api/leaderboard").json()["total_votes"] == 1
    with TestClient(create_app(settings, fake)) as client:
        body = {"browser_id": str(uuid4()), "prompt": "Hi"}
        assert client.post("/api/comparisons", json=body).status_code == 429
        clock[0] += 60
        assert client.post("/api/comparisons", json=body).status_code == 201
        clock[0] += 60
        rejected = client.post("/api/comparisons", json=body)
        assert rejected.status_code == 429
        assert rejected.headers["retry-after"] == str(86400 - 120)
        clock[0] = 172800
        assert client.post("/api/comparisons", json=body).status_code == 201


def test_global_reservation_is_atomic_and_rolls_back_rejection(tmp_path):
    url = f"sqlite:///{tmp_path / 'atomic.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    settings = Settings(_env_file=None, comparison_limit_per_minute=10, comparison_limit_per_day=2)

    def attempt(_):
        # Separate engines represent separate workers, not a shared Python lock.
        worker = create_engine(url)
        try:
            with Session(worker) as db:
                try:
                    reserve_generation(db, settings, 86400)
                    return True
                except HTTPException as error:
                    assert error.status_code == 429
                    return False
        finally:
            worker.dispose()

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(attempt, range(8))) == 2
    with Session(engine) as db:
        assert {row.bucket: row.count for row in db.scalars(select(GenerationLimit))} == {"minute": 2, "day": 2}
    engine.dispose()


def test_rejected_requests_do_not_call_provider(tmp_path):
    calls = []

    async def counted(settings, model, prompt):
        calls.append(model)
        return await fake(settings, model, prompt)

    settings = Settings(_env_file=None, gemini_api_key="test-only",
        database_url=f"sqlite:///{tmp_path / 'provider.db'}", comparison_limit_per_minute=1)
    with TestClient(create_app(settings, counted)) as client:
        for _ in range(2):
            client.post("/api/comparisons", json={"browser_id": str(uuid4()), "prompt": "Hi"},
                headers={"X-Forwarded-For": str(uuid4())})
    assert len(calls) == 2


@pytest.mark.parametrize("code,category", [(429, "quota_or_rate_limit"), (403, "permission"), (404, "not_found"), (503, "provider_unavailable")])
def test_provider_diagnostics_are_allowlisted(monkeypatch, caplog, code, category):
    sentinel = "private-sentinel-must-not-appear"

    class Failure(Exception):
        response_json = {"error": {"message": sentinel, "details": [{"retryDelay": "12.5s", "secret": sentinel}]}}

    failure = Failure(sentinel)
    failure.code = code

    class AsyncClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        @property
        def models(self): return self
        async def generate_content(self, **kwargs): raise failure

    class Client:
        def __init__(self, **kwargs): self.aio = AsyncClient()

    monkeypatch.setattr("app.main.genai.Client", Client)
    with caplog.at_level(logging.WARNING):
        result = asyncio.run(generate(Settings(_env_file=None, gemini_api_key=sentinel), "gemini-test", sentinel))
    assert sentinel not in caplog.text
    assert sentinel not in str(result)
    assert f"http_status={code}" in caplog.text
    assert f"category={category}" in caplog.text
    assert "retry_after_seconds=12.5" in caplog.text
    assert not caplog.records[-1].exc_info


def test_diagnostics_reject_untrusted_fields_and_log_timeouts(caplog):
    failure = RuntimeError("private-sentinel")
    failure.code = "private-sentinel"
    failure.response_json = {"error": {"details": [{"retryDelay": "private-sentinel"}]}}
    with caplog.at_level(logging.WARNING):
        log_provider_failure("private-sentinel", failure)
        log_provider_failure("gemini-test", timeout=True)
    assert "private-sentinel" not in caplog.text
    assert "model=unrecognized http_status=None category=unknown retry_after_seconds=None" in caplog.text
    assert "category=timeout" in caplog.text
