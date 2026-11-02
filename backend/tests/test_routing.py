import pytest
from django.urls import resolve, reverse

from apps.core.views import HealthView


def test_health_route_is_versioned():
    assert reverse("api_v1:health") == "/api/v1/health/"
    assert resolve("/api/v1/health/").func.view_class is HealthView


@pytest.mark.parametrize(
    "path", ["/api/v2/health/", "/health/", "/api/health/", "/api/v1/unknown/"]
)
def test_unknown_or_unversioned_paths_return_json_404(client, path):
    response = client.get(path)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_api_schema_and_docs_load(client):
    schema = client.get("/api/schema/")
    assert schema.status_code == 200
    assert b"/api/v1/health/" in schema.content

    docs = client.get("/api/docs/")
    assert docs.status_code == 200


def test_unknown_api_path_is_json_even_in_debug(client, settings):
    settings.DEBUG = True

    response = client.get("/api/v1/does-not-exist/")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
