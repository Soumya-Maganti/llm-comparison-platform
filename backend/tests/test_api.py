import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import Settings, create_app, generate


@pytest.fixture
def setup(tmp_path):
    settings = Settings(
        _env_file=None,
        gemini_api_key="test-only",
        database_url=f'sqlite:///{tmp_path / "test.db"}',
        comparison_limit_per_minute=1000,
        comparison_limit_per_day=1000,
    )
    active = set()

    async def fake(settings, model, prompt):
        active.add(model)
        await asyncio.sleep(0.02)
        assert len(active) == 2, "Models must run concurrently"
        return dict(model=model, text=f"Answer from {model}", error=None, latency_ms=20)

    return settings, fake


def test_comparison_vote_history_and_persistence(setup):
    settings, fake = setup
    identity = str(uuid4())
    with TestClient(create_app(settings, fake)) as client:
        result = client.post(
            "/api/comparisons",
            json={"browser_id": identity, "prompt": "Explain gravity"},
        )
        assert result.status_code == 201
        row = result.json()
        assert len({r["model"] for r in row["responses"]}) == 2
        assert (
            client.get("/api/history", params={"browser_id": str(uuid4())}).json() == []
        )
        vote = {"browser_id": identity, "response_id": row["responses"][0]["id"]}
        path = f'/api/comparisons/{row["id"]}/votes'
        assert (
            client.post(path, json={**vote, "browser_id": str(uuid4())}).status_code
            == 404
        )
        assert (
            client.post(path, json={**vote, "response_id": str(uuid4())}).status_code
            == 400
        )
        assert client.post(path, json=vote).status_code == 201
        assert client.post(path, json=vote).status_code == 409
        board = client.get("/api/leaderboard").json()
        assert board["total_votes"] == 1
        assert board["models"][0]["vote_percentage"] == 100
    with TestClient(create_app(settings, fake)) as client:
        saved = client.get("/api/history", params={"browser_id": identity}).json()
        assert saved[0]["voted_response_id"] == vote["response_id"]
        assert datetime.fromisoformat(
            saved[0]["created_at"]
        ).utcoffset() == timezone.utc.utcoffset(None)
        assert client.get("/api/leaderboard").json()["total_votes"] == 1


def test_validation_and_missing_key(setup):
    settings, fake = setup
    settings.gemini_api_key = ""
    with TestClient(create_app(settings, fake)) as client:
        for prompt in ["", "   ", "a" * 12001]:
            assert (
                client.post(
                    "/api/comparisons",
                    json={"browser_id": str(uuid4()), "prompt": prompt},
                ).status_code
                == 422
            )
        assert (
            client.post(
                "/api/comparisons", json={"browser_id": "invalid", "prompt": "Hi"}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/comparisons", json={"browser_id": str(uuid4()), "prompt": "Hi"}
            ).status_code
            == 503
        )
        assert (
            client.get(
                "/api/history", params={"browser_id": str(uuid4()), "limit": 101}
            ).status_code
            == 422
        )
        assert client.get("/api/health").json()["configured"] is False


def test_partial_failure_cannot_be_voted(setup):
    settings, _ = setup

    async def partial(settings, model, prompt):
        return dict(
            model=model,
            text="OK" if model == settings.model_a else "",
            error=None if model == settings.model_a else "Unavailable",
            latency_ms=1,
        )

    with TestClient(create_app(settings, partial)) as client:
        identity = str(uuid4())
        row = client.post(
            "/api/comparisons", json={"browser_id": identity, "prompt": "Hi"}
        ).json()
        assert any(r["error"] for r in row["responses"])
        assert (
            client.post(
                f'/api/comparisons/{row["id"]}/votes',
                json={"browser_id": identity, "response_id": row["responses"][0]["id"]},
            ).status_code
            == 400
        )


def test_models_must_be_distinct():
    with pytest.raises(ValueError):
        Settings(_env_file=None, model_a="same", model_b="same")
    with pytest.raises(ValueError):
        Settings(_env_file=None, model_a=" same ", model_b="same")
    with pytest.raises(ValueError):
        Settings(_env_file=None, model_a="   ")


def test_production_cors_preflight(setup):
    settings, fake = setup
    settings.cors_origins = ["https://assessment-demo.vercel.app"]
    with TestClient(create_app(settings, fake)) as client:
        headers = {
            "Origin": settings.cors_origins[0],
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        }
        allowed = client.options("/api/comparisons", headers=headers)
        assert allowed.status_code == 200
        assert (
            allowed.headers["access-control-allow-origin"] == settings.cors_origins[0]
        )
        denied = client.options(
            "/api/comparisons",
            headers={**headers, "Origin": "https://unrelated.example"},
        )
        assert denied.status_code == 400
        assert "access-control-allow-origin" not in denied.headers


def test_postgresql_schema_compiles():
    from sqlalchemy import create_mock_engine
    from app.main import Base

    statements = []
    engine = create_mock_engine(
        "postgresql+psycopg://",
        lambda statement, *args, **kwargs: statements.append(
            str(statement.compile(dialect=engine.dialect))
        ),
    )
    Base.metadata.create_all(engine)
    schema = "\n".join(statements)
    for table in ["comparisons", "responses", "votes"]:
        assert f"CREATE TABLE {table}" in schema
    assert "UNIQUE (comparison_id, browser_id)" in schema
    assert "FOREIGN KEY(response_id) REFERENCES responses (id)" in schema


def test_leaderboard_counts_only_stored_votes_across_users_and_restarts(setup):
    settings, fake = setup
    with TestClient(create_app(settings, fake)) as client:
        initial = client.get("/api/leaderboard").json()
        assert initial["total_votes"] == 0
        assert all(
            model["wins"] == 0 and model["vote_percentage"] == 0
            for model in initial["models"]
        )
        for winner in [settings.model_a, settings.model_a, settings.model_b, None]:
            identity = str(uuid4())
            row = client.post(
                "/api/comparisons",
                json={"browser_id": identity, "prompt": "Compare models"},
            ).json()
            if winner:
                response = next(r for r in row["responses"] if r["model"] == winner)
                vote = client.post(
                    f'/api/comparisons/{row["id"]}/votes',
                    json={"browser_id": identity, "response_id": response["id"]},
                )
                assert vote.status_code == 201
    with TestClient(create_app(settings, fake)) as client:
        board = client.get("/api/leaderboard").json()
        assert board["total_votes"] == 3  # The fourth, unvoted comparison adds no wins.
        assert board["models"] == [
            {"model": settings.model_a, "wins": 2, "vote_percentage": 66.7},
            {"model": settings.model_b, "wins": 1, "vote_percentage": 33.3},
        ]


def test_history_pagination_keeps_older_comparisons_and_votes(setup):
    settings, fake = setup
    identity = str(uuid4())
    with TestClient(create_app(settings, fake)) as client:
        ids = []
        for index in range(23):
            row = client.post(
                "/api/comparisons",
                json={"browser_id": identity, "prompt": f"Prompt {index}"},
            ).json()
            ids.append(row["id"])
            if index == 0:
                chosen = row["responses"][0]["id"]
                assert (
                    client.post(
                        f'/api/comparisons/{row["id"]}/votes',
                        json={"browser_id": identity, "response_id": chosen},
                    ).status_code
                    == 201
                )
    with TestClient(create_app(settings, fake)) as client:
        first = client.get("/api/history", params={"browser_id": identity}).json()
        older = client.get(
            "/api/history", params={"browser_id": identity, "offset": 20}
        ).json()
        assert len(first) == 20 and len(older) == 3
        assert [row["id"] for row in first + older] == ids[::-1]
        assert older[-1]["voted_response_id"] == chosen


@pytest.mark.parametrize(
    "failure,expected",
    [
        (RuntimeError("secret-key-must-not-leak"), "Model request failed"),
        (asyncio.TimeoutError(), "Model request timed out"),
    ],
)
def test_provider_errors_are_sanitized(monkeypatch, failure, expected):
    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        @property
        def models(self):
            return self

        async def generate_content(self, **kwargs):
            raise failure

    class FakeClient:
        def __init__(self, **kwargs):
            self.aio = FakeAsyncClient()

    monkeypatch.setattr("app.main.genai.Client", FakeClient)
    result = asyncio.run(generate(Settings(_env_file=None), "test-model", "Hi"))
    assert result["error"].startswith(expected)
    assert "secret-key-must-not-leak" not in str(result)
    assert result["latency_ms"] >= 0
