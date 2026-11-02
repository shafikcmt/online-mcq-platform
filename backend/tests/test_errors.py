from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView


class _PhoneSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=5)


class _EchoView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = _PhoneSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return None


class _ProtectedView(APIView):
    def get(self, request):
        return None


def test_validation_errors_use_standard_shape():
    request = APIRequestFactory().post("/x/", {"phone": "123456789"}, format="json")
    response = _EchoView.as_view()(request)

    assert response.status_code == 400
    error = response.data["error"]
    assert error["code"] == "validation_error"
    assert error["message"]
    assert "phone" in error["field_errors"]


def test_default_permission_denies_anonymous_requests():
    # Until authentication exists (Milestone 2) every view is closed unless it opts in.
    response = _ProtectedView.as_view()(APIRequestFactory().get("/x/"))

    assert response.status_code in (401, 403)
    assert response.data["error"]["code"] in ("not_authenticated", "permission_denied")
