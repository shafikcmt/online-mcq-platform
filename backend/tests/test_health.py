import pytest
from django.urls import reverse


@pytest.fixture
def health_url():
    return reverse("api_v1:health")


def test_health_returns_ok(client, health_url):
    response = client.get(health_url)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response["Content-Type"].startswith("application/json")


def test_health_needs_no_authentication(client, health_url):
    # No Authorization header at all — must still succeed.
    assert client.get(health_url).status_code == 200


def test_health_reveals_nothing_else(client, health_url):
    assert set(client.get(health_url).json()) == {"status"}


def test_health_rejects_write_methods_with_standard_error(client, health_url):
    response = client.post(health_url, data={}, content_type="application/json")

    assert response.status_code == 405
    body = response.json()
    assert body["error"]["code"] == "method_not_allowed"
    assert body["error"]["message"]


def test_health_without_trailing_slash_redirects(client):
    response = client.get("/api/v1/health")

    assert response.status_code == 301
    assert response["Location"] == "/api/v1/health/"
