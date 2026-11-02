"""Explicitly opt-in: makes two real Gemini requests and may consume API quota."""

import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import Settings, create_app


@pytest.mark.skipif(
    os.environ.get("RUN_LIVE_GEMINI") != "1",
    reason="Live Gemini verification requires RUN_LIVE_GEMINI=1",
)
def test_live_gemini_comparison_vote_and_persistence(tmp_path):
    settings = Settings(database_url=f'sqlite:///{tmp_path / "live.db"}')
    assert (
        settings.gemini_api_key.strip()
    ), "Configure GEMINI_API_KEY in backend/.env first"
    identity = str(uuid4())
    with TestClient(create_app(settings)) as client:
        result = client.post(
            "/api/comparisons",
            json={
                "browser_id": identity,
                "prompt": "In one short sentence, explain why version control is useful.",
            },
        )
        assert result.status_code == 201
        row = result.json()
        assert len({response["model"] for response in row["responses"]}) == 2
        for response in row["responses"]:
            assert (
                response["error"] is None
            ), f"{response['model']}: {response['error']}"
            assert response["text"].strip()
        chosen = row["responses"][0]["id"]
        assert (
            client.post(
                f'/api/comparisons/{row["id"]}/votes',
                json={"browser_id": identity, "response_id": chosen},
            ).status_code
            == 201
        )
    with TestClient(create_app(settings)) as client:
        history = client.get("/api/history", params={"browser_id": identity}).json()
        assert history[0]["id"] == row["id"]
        assert history[0]["voted_response_id"] == chosen
        assert client.get("/api/leaderboard").json()["total_votes"] == 1
