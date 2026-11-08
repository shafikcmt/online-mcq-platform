# ruff: noqa: F811 -- pytest fixtures imported from the Phase 3 file are re-named as test arguments
"""Phase 6: the payment gateway system under attack.

Not "does the feature work" (the earlier test files do that) but "what can a hostile or
careless caller do": reach admin APIs without being an admin, send junk, read a secret back
out of any response, log line or table, steer a payment to another merchant account, replay
or forge a provider callback, or turn a sandbox payment into real access.

Providers are faked; nothing here talks to a real bKash or SSLCommerz."""

import json
import re
import threading
import uuid
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.db import connection
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.audit.models import AuditLog
from apps.payments import gateway_manager, gateway_store, services
from apps.payments.models import (
    Payment,
    PaymentEvent,
    PaymentGateway,
    PaymentGatewayCredential,
    PaymentGatewayLog,
    PaymentStatus,
)
from apps.subscriptions.models import Subscription

# Fixtures and helpers of the Phase 3 file (imported so they apply here too).
from tests.test_payment_gateways_admin import (  # noqa: F401
    ADMIN,
    LIVE_CREDS,
    PASSWORD,
    SANDBOX_CREDS,
    _env,
    admin_user,
    api,
    bkash,
    ctx,
    make_gateway,
    make_tester,
    package,
    pay_success,
    post,
    start,
    student,
)
from tests.test_subscriptions import jwt_client

pytestmark = pytest.mark.django_db


# ======================================================================================
# 1. Who can reach the admin APIs
# ======================================================================================
_PARAM = re.compile(r"<(?:(?P<conv>\w+):)?(?P<name>\w+)>")


def _admin_routes() -> list[str]:
    """Every ``/api/v1/admin/...`` route of the project, with sample values filled in for
    the path parameters. Walks the live URL configuration, so a route added later is
    covered without touching this test."""
    sample = {"uuid": str(uuid.uuid4()), "int": "1", "slug": "x", "str": "x", None: "x"}
    found: list[str] = []

    def walk(patterns, prefix=""):
        for entry in patterns:
            if isinstance(entry, URLResolver):
                walk(entry.url_patterns, prefix + str(entry.pattern))
            elif isinstance(entry, URLPattern):
                route = prefix + str(entry.pattern)
                if "^" in route or "(?" in route:
                    continue  # a regular-expression route (the provider callbacks: public)
                found.append(_PARAM.sub(lambda m: sample.get(m.group("conv"), "x"), route))

    walk(get_resolver().url_patterns)
    return sorted({"/" + route.lstrip("/") for route in found if "/admin/" in "/" + route})


ADMIN_ROUTES = _admin_routes()
METHODS = ("get", "post", "put", "patch", "delete")
# The only admin-prefixed routes that must answer before sign-in: the sign-in itself and the
# CSRF cookie it needs. Anything new that appears here is a decision to make, not a default.
PUBLIC_BY_DESIGN = {"/api/v1/admin/auth/csrf/", "/api/v1/admin/auth/login/"}


def test_the_route_crawl_actually_finds_the_gateway_api():
    assert len(ADMIN_ROUTES) > 30, ADMIN_ROUTES
    for needle in ("payment-gateways/", "payment-testers/", "revoke/", "credentials/", "mode/"):
        assert any(needle in route for route in ADMIN_ROUTES), needle


@pytest.mark.parametrize("who", ["anonymous", "student"])
def test_no_admin_route_answers_anyone_but_an_admin(who, student):
    """Every route x every method: an anonymous visitor or a student gets 401/403, never a
    success, a 404 (which would mean the code ran before the guard), or a crash."""
    client = APIClient()
    if who == "student":
        client.force_login(student)
    bad = []
    for route in ADMIN_ROUTES:
        if route in PUBLIC_BY_DESIGN:
            continue
        for method in METHODS:
            response = getattr(client, method)(route, {}, format="json")
            if response.status_code not in (401, 403, 405):
                bad.append((method.upper(), route, response.status_code))
    assert not bad, bad


def test_writes_need_the_csrf_token(admin_user):
    """A forged cross-site request (valid session cookie, no CSRF token) is refused."""
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(admin_user)
    response = client.post(
        ADMIN,
        json.dumps({"adapter": "bkash", "slug": "forged"}),
        content_type="application/json",
    )
    assert response.status_code == 403
    assert not PaymentGateway.objects.filter(slug="forged").exists()


def test_a_gateway_cannot_be_deleted_through_the_api(api, ctx):
    gateway = make_gateway(ctx)
    for method in ("delete", "put"):
        response = getattr(api, method)(f"{ADMIN}{gateway.public_id}/", {}, format="json")
        assert response.status_code == 405
    assert PaymentGateway.objects.filter(pk=gateway.pk).exists()


def test_a_student_token_is_not_an_admin_session(student, ctx):
    """The mobile app's bearer token reaches the student API, not the admin one."""
    client = jwt_client(student)
    assert client.get(ADMIN).status_code in (401, 403)
    assert client.post(f"{ADMIN}adapters/", {}, format="json").status_code in (401, 403, 405)


# ======================================================================================
# 2. Junk input never crashes anything
# ======================================================================================
JUNK = [
    None,
    [],
    [1, 2, 3],
    "text",
    123,
    True,
    {},
    {"mode": []},
    {"mode": {"a": 1}},
    {"mode": "live\u0000"},
    {"mode": "x" * 10_000},
    {"password": ["x"], "mode": "live"},
    {"password": PASSWORD, "mode": "live", "values": "not a dict"},
    {"password": PASSWORD, "mode": "sandbox", "values": []},
    {"password": PASSWORD, "mode": "sandbox", "values": {"app_key": {"a": 1}}},
    {"password": PASSWORD, "mode": "sandbox", "values": {"app_key": 123}},
    {"password": PASSWORD, "mode": "sandbox", "values": {"app_key": ["x"]}},
    {"password": PASSWORD, "mode": "sandbox", "values": {"app_key": "k" * 100_000}},
    {"password": PASSWORD, "mode": "sandbox", "values": {"app_key\u0000": "v"}},
    {"password": PASSWORD, "mode": "sandbox", "values": {"": "v"}},
    {"adapter": ["bkash"], "slug": {"a": 1}},
    {"adapter": "bkash", "slug": "ok-slug", "options": "x"},
    {"adapter": "bkash", "slug": "ok-slug", "options": {"timeout_seconds": "abc"}},
    {"adapter": "bkash", "slug": "ok-slug", "options": {"timeout_seconds": 10**30}},
    {"adapter": "bkash", "slug": "ok-slug", "name_en": "n" * 100_000},
    {"adapter": "bkash", "slug": "ok-slug", "name_en": "<script>alert(1)</script>"},
    {"adapter": "bkash", "slug": "ok-slug", "currencies": "BDT"},
    {"adapter": "bkash", "slug": "ok-slug", "currencies": [["BDT"]]},
    {"adapter": "bkash", "slug": "ok-slug", "min_amount": "NaN"},
    {"adapter": "bkash", "slug": "ok-slug", "min_amount": "Infinity"},
    {"adapter": "bkash", "slug": "ok-slug", "min_amount": "-5"},
    {"adapter": "bkash", "slug": "ok-slug", "min_amount": 1e400},
    {"adapter": "bkash", "slug": "ok-slug", "priority": "high"},
    {"adapter": "bkash", "slug": "ok-slug", "priority": 10**30},
    {"adapter": "bkash", "slug": "ok-slug", "logo_url": "javascript:alert(1)"},
    {"adapter": "bkash", "slug": "ok-slug", "app_return_url": "data:text/html,<script>"},
    {"adapter": "bkash", "slug": "ok-slug", "web_return_url": "//evil.example/x"},
    {"user_id": "abc"},
    {"user_id": 10**30},
    {"user_id": -1},
    {"user_id": None},
]
RAW_BODIES = [b"{", b"[", b"\xff\xfe", b"", b"null", b"{" * 5000]


def _fuzz_targets(gateway, tester_user):
    gid = gateway.public_id
    return [
        ("post", ADMIN),
        ("patch", f"{ADMIN}{gid}/"),
        ("post", f"{ADMIN}{gid}/credentials/"),
        ("post", f"{ADMIN}{gid}/mode/"),
        ("post", f"{ADMIN}{gid}/enable/"),
        ("post", f"{ADMIN}{gid}/disable/"),
        ("post", f"{ADMIN}{gid}/test/"),
        ("post", "/api/v1/admin/payment-testers/"),
        ("delete", f"/api/v1/admin/payment-testers/{tester_user.pk}/"),
        ("post", "/api/v1/admin/test-subscriptions/1/revoke/"),
    ]


def test_junk_json_never_causes_a_server_error(api, ctx, student, bkash):
    gateway = make_gateway(ctx)
    cache.clear()
    failures = []
    for method, url in _fuzz_targets(gateway, student):
        for body in JUNK:
            cache.clear()  # keep the password-attempt budget out of the way
            response = api.generic(
                method.upper(), url, json.dumps(body), content_type="application/json"
            )
            if response.status_code >= 500:
                failures.append(
                    (method, url, body if len(str(body)) < 80 else "…", response.status_code)
                )
    assert not failures, failures


def test_malformed_bodies_never_cause_a_server_error(api, ctx, student, bkash):
    gateway = make_gateway(ctx)
    failures = []
    for method, url in _fuzz_targets(gateway, student):
        for raw in RAW_BODIES:
            cache.clear()
            response = api.generic(method.upper(), url, raw, content_type="application/json")
            if response.status_code >= 500:
                failures.append((method, url, raw[:20], response.status_code))
    assert not failures, failures


def test_junk_never_changes_a_gateway_it_was_not_allowed_to(api, ctx, student, bkash):
    gateway = make_gateway(ctx)
    before = PaymentGateway.objects.filter(pk=gateway.pk).values().get()
    credentials = list(PaymentGatewayCredential.objects.values_list("field", "value_encrypted"))
    for method, url in _fuzz_targets(gateway, student):
        if url.endswith("/enable/") or url.endswith("/disable/") or url.endswith("/test/"):
            continue
        for body in JUNK:
            cache.clear()
            api.generic(method.upper(), url, json.dumps(body), content_type="application/json")
    after = PaymentGateway.objects.filter(pk=gateway.pk).values().get()
    after.pop("updated_at"), before.pop("updated_at")
    # An accepted, valid PATCH may rename it; what must never move is mode or credentials.
    assert after["mode"] == before["mode"] == "sandbox"
    assert sorted(
        PaymentGatewayCredential.objects.values_list("field", "value_encrypted")
    ) == sorted(credentials)


def test_a_hostile_slug_or_name_is_stored_inert(api):
    """No markup is interpreted by the API; it is returned as plain JSON text (the panel's
    React escapes it). Nothing executable is accepted as a URL."""
    response = post(
        api,
        ADMIN,
        {"adapter": "bkash", "slug": "xss-test", "name_en": "<img src=x onerror=alert(1)>"},
    )
    assert response.status_code == 201
    assert response.json()["name_en"] == "<img src=x onerror=alert(1)>"
    assert response["Content-Type"].startswith("application/json")
    bad = post(api, ADMIN, {"adapter": "bkash", "slug": "<script>"})
    assert bad.status_code == 400


# ======================================================================================
# 3. A secret never comes back out
# ======================================================================================
CANARIES = [*SANDBOX_CREDS.values(), *LIVE_CREDS.values()]


def _tables_text() -> str:
    """Everything the system wrote down that an admin, a log reader or a database dump could
    see in clear: logs, audit, events, the credentials' hints and every payment row."""
    return json.dumps(
        [
            list(PaymentGatewayLog.objects.values()),
            list(AuditLog.objects.values()),
            list(PaymentEvent.objects.values()),
            list(Payment.objects.values()),
            list(PaymentGatewayCredential.objects.values("field", "mode", "hint")),
        ],
        default=str,
    )


def _assert_clean(blob: str, where: str):
    leaked = [secret for secret in CANARIES + [PASSWORD] if secret in blob]
    assert not leaked, f"{where}: {leaked}"


def test_no_response_log_or_table_ever_contains_a_credential(
    api, ctx, student, package, bkash, caplog
):
    make_tester(student, ctx.actor)
    caplog.set_level("DEBUG")
    gateway = make_gateway(ctx, creds=None)
    gid = gateway.public_id
    # Set credentials through the API (also exercises the password path).
    for mode, creds in (("sandbox", SANDBOX_CREDS), ("live", LIVE_CREDS)):
        response = post(
            api, f"{ADMIN}{gid}/credentials/", {"mode": mode, "values": creds, "password": PASSWORD}
        )
        assert response.status_code == 200, response.content
        _assert_clean(response.content.decode(), f"set credentials {mode}")
    seen = []
    for url in (
        ADMIN,
        f"{ADMIN}{gid}/",
        f"{ADMIN}{gid}/logs/",
        f"{ADMIN}adapters/",
        f"{ADMIN}stats/",
        "/api/v1/admin/payment-testers/",
    ):
        response = api.get(url)
        assert response.status_code == 200, url
        seen.append(response.content.decode())
    # A connection test and a payment through the gateway.
    seen.append(post(api, f"{ADMIN}{gid}/test/").content.decode())
    payment = start(student, package, gateway=gateway.slug, channel="web")
    pay_success(payment, bkash)
    client = jwt_client(student)
    seen.append(client.get("/api/v1/payments/methods/").content.decode())
    seen.append(client.get("/api/v1/payments/").content.decode())
    seen.append(client.get(f"/api/v1/payments/{payment.public_id}/").content.decode())
    for blob in seen:
        _assert_clean(blob, "response")
    _assert_clean(_tables_text(), "tables")
    _assert_clean(caplog.text, "log output")
    # What the admin sees of a secret is a hint of at most four characters.
    hints = PaymentGatewayCredential.objects.values_list("hint", flat=True)
    assert all(len(hint) <= 4 for hint in hints)


def test_the_stored_value_is_ciphertext_and_the_hint_is_not_the_secret(ctx):
    gateway = make_gateway(ctx)
    for row in PaymentGatewayCredential.objects.filter(gateway=gateway):
        assert row.value_encrypted not in CANARIES
        assert not any(secret in row.value_encrypted for secret in CANARIES)
        assert len(row.hint) <= 4
    with connection.cursor() as cursor:
        cursor.execute("select value_encrypted from payments_paymentgatewaycredential")
        dump = " ".join(value for (value,) in cursor.fetchall())
    _assert_clean(dump, "raw database rows")


def test_a_provider_error_that_quotes_the_credentials_is_not_passed_on(api, ctx, monkeypatch):
    """An upstream error text (a proxy, a library) may contain the request headers. The
    connection test must report a short stable reason, never that text."""
    gateway = make_gateway(ctx)
    leak = "boom " + " ".join(SANDBOX_CREDS.values())

    def explode(*args, **kwargs):
        raise RuntimeError(leak)

    monkeypatch.setattr("apps.payments.gateways.bkash.request_json", explode)
    response = post(api, f"{ADMIN}{gateway.public_id}/test/")
    assert response.status_code < 500, response.content
    _assert_clean(response.content.decode(), "connection test")
    _assert_clean(_tables_text(), "tables after a failing test")


def test_the_django_admin_never_shows_a_credential(admin_user, ctx):
    gateway = make_gateway(ctx)
    admin_user.is_staff = admin_user.is_superuser = True
    admin_user.save()
    client = APIClient()
    client.force_login(admin_user)
    for path in (
        "/admin/payments/paymentgateway/",
        f"/admin/payments/paymentgateway/{gateway.pk}/change/",
        "/admin/payments/paymentgatewaylog/",
        "/admin/payments/payment/",
    ):
        for admin_path in (path,):
            response = client.get(admin_path, follow=True)
            _assert_clean(response.content.decode(errors="replace"), admin_path)
    # The credential table itself is not even registered there.
    assert client.get("/admin/payments/paymentgatewaycredential/", follow=True).status_code in (
        403,
        404,
    )


# ======================================================================================
# 4. The password re-confirmation cannot be dodged
# ======================================================================================
def test_the_attempt_budget_is_per_admin_and_survives_other_requests(api, ctx):
    gateway = make_gateway(ctx)
    url = f"{ADMIN}{gateway.public_id}/credentials/"
    body = {"mode": "sandbox", "values": {"app_key": "new-key-value"}, "password": "wrong"}
    codes = [post(api, url, body).status_code for _ in range(5)]
    assert codes == [403] * 5
    # Now even the right password is refused for a while: guessing cannot continue.
    assert post(api, url, {**body, "password": PASSWORD}).status_code == 429
    # Other, harmless reads still work (no lock-out of the whole session).
    assert api.get(f"{ADMIN}{gateway.public_id}/").status_code == 200
    assert PaymentGatewayCredential.objects.get(gateway=gateway, field="app_key").hint != "alue"


def test_password_is_required_for_every_credential_and_mode_change(api, ctx):
    gateway = make_gateway(ctx)
    for url, body in (
        (
            f"{ADMIN}{gateway.public_id}/credentials/",
            {"mode": "sandbox", "values": {"app_key": "z" * 8}},
        ),
        (f"{ADMIN}{gateway.public_id}/mode/", {"mode": "live"}),
    ):
        for password in (None, "", " ", [], {}, 0, False):
            cache.clear()
            response = post(api, url, {**body, "password": password})
            assert response.status_code in (400, 403), (url, password, response.status_code)
    assert gateway_store.read_credentials(gateway, "sandbox")["app_key"] == SANDBOX_CREDS["app_key"]
    gateway.refresh_from_db()
    assert gateway.mode == "sandbox"


def test_the_password_itself_is_never_written_down(api, ctx, caplog):
    caplog.set_level("DEBUG")
    gateway = make_gateway(ctx)
    post(
        api,
        f"{ADMIN}{gateway.public_id}/credentials/",
        {"mode": "sandbox", "values": {"app_key": "q" * 9}, "password": PASSWORD},
    )
    post(api, f"{ADMIN}{gateway.public_id}/mode/", {"mode": "live", "password": PASSWORD})
    post(api, f"{ADMIN}{gateway.public_id}/mode/", {"mode": "live", "password": "Wrong-guess-1"})
    blob = _tables_text() + caplog.text
    assert PASSWORD not in blob and "Wrong-guess-1" not in blob


# ======================================================================================
# 5. Sandbox and live cannot be mixed up
# ======================================================================================
def test_going_live_cannot_be_forced_around_the_rule(api, ctx, admin_user):
    """No request shape gets a gateway to live without live credentials and a proven
    sandbox payment: not the mode endpoint, not a PATCH, not a create with mode=live."""
    gateway = make_gateway(ctx)
    assert (
        post(
            api, f"{ADMIN}{gateway.public_id}/mode/", {"mode": "live", "password": PASSWORD}
        ).status_code
        == 409
    )
    for body in ({"mode": "live"}, {"enabled": True, "mode": "live"}, {"mode": "LIVE"}):
        api.patch(f"{ADMIN}{gateway.public_id}/", body, format="json")
    created = post(
        api, ADMIN, {"adapter": "bkash", "slug": "born-live", "mode": "live", "enabled": True}
    )
    gateway.refresh_from_db()
    assert gateway.mode == "sandbox"
    born = PaymentGateway.objects.filter(slug="born-live").first()
    assert born is None or (born.mode == "sandbox" and not born.enabled), created.content


def test_the_proof_must_be_this_gateways_own_sandbox_payment(api, ctx, student, package, bkash):
    other = make_gateway(ctx)
    target = make_gateway(ctx, creds=SANDBOX_CREDS)
    gateway_store.save_credentials(target, "live", LIVE_CREDS, ctx=ctx)
    make_tester(student, ctx.actor)
    pay_success(start(student, package, gateway=other.slug, channel="web"), bkash, trx="OTHER")
    # A sandbox success on ANOTHER gateway does not count for this one.
    assert (
        post(
            api, f"{ADMIN}{target.public_id}/mode/", {"mode": "live", "password": PASSWORD}
        ).status_code
        == 409
    )
    # Nor does a sandbox payment that is merely pending or failed.
    pending = start(student, package, gateway=target.slug, channel="web")
    assert (
        post(
            api, f"{ADMIN}{target.public_id}/mode/", {"mode": "live", "password": PASSWORD}
        ).status_code
        == 409
    )
    pay_success(pending, bkash, trx="TARGET")
    assert (
        post(
            api, f"{ADMIN}{target.public_id}/mode/", {"mode": "live", "password": PASSWORD}
        ).status_code
        == 200
    )


def test_a_payment_started_in_sandbox_never_touches_live_credentials(ctx, student, package, bkash):
    gateway = make_gateway(ctx, creds=None)
    gateway_store.save_credentials(gateway, "sandbox", SANDBOX_CREDS, ctx=ctx)
    gateway_store.save_credentials(gateway, "live", LIVE_CREDS, ctx=ctx)
    make_tester(student, ctx.actor)
    payment = start(student, package, gateway=gateway.slug, channel="web")
    PaymentGateway.objects.filter(pk=gateway.pk).update(mode="live")  # flipped under it
    bkash.calls.clear()
    services.admin_reverify.__globals__["_query"](Payment.objects.get(pk=payment.pk))
    for call in bkash.calls:
        assert LIVE_CREDS["username"] not in json.dumps(call["headers"])
        assert LIVE_CREDS["app_key"] not in json.dumps(call["headers"])
        assert "sandbox" in call["url"]


def test_a_sandbox_success_never_becomes_real_access(ctx, student, package, bkash):
    gateway = make_gateway(ctx)
    make_tester(student, ctx.actor)
    payment = start(student, package, gateway=gateway.slug, channel="app")
    pay_success(payment, bkash)
    subs = Subscription.objects.filter(user=student)
    assert subs.count() == 1 and all(sub.is_test for sub in subs)
    # Replaying the success again changes nothing.
    services.apply_verification(
        payment.pk, services.admin_reverify.__globals__["_query"](payment), source="replay"
    )
    assert Subscription.objects.filter(user=student).count() == 1


# ======================================================================================
# 6. Provider callbacks cannot be forged, replayed or aimed at another account
# ======================================================================================
def _ssl_gateway(ctx, slug, password):
    gateway = PaymentGateway.objects.create(
        slug=slug,
        adapter="sslcommerz",
        name_en=slug,
        currencies=["BDT"],
        mode="sandbox",
        enabled=True,
    )
    gateway_store.save_credentials(
        gateway, "sandbox", {"store_id": f"{slug}-id", "store_password": password}, ctx=ctx
    )
    return gateway


def _md5(text):
    import hashlib

    return hashlib.md5(text.encode()).hexdigest()  # noqa: S324 - SSLCommerz's own scheme


def _sign(data, password):
    data = dict(data)
    keys = list(data)
    fields = {k: data[k] for k in keys} | {"store_passwd": _md5(password)}
    data["verify_key"] = ",".join(keys)
    data["verify_sign"] = _md5("&".join(f"{k}={fields[k]}" for k in sorted(fields)))
    return data


def test_a_callback_signed_for_another_merchant_account_grants_nothing(
    ctx, student, package, monkeypatch
):
    """Two SSLCommerz accounts. A payment was made under account A; a callback signed with
    account B's store password (an attacker who owns account B) must not be accepted."""
    make_tester(student, ctx.actor)
    from apps.payments.gateways import sslcommerz

    account_a = _ssl_gateway(ctx, "ssl-a", "password-of-account-a")
    _ssl_gateway(ctx, "ssl-b", "password-of-account-b")
    validations = []
    monkeypatch.setattr(
        sslcommerz.SslCommerzGateway,
        "_get",
        lambda self, path, params: validations.append(params) or {"status": "VALID"},
    )
    monkeypatch.setattr(
        sslcommerz.SslCommerzGateway,
        "initiate",
        lambda self, payment, urls, customer: sslcommerz.InitiateResult(
            checkout_url="https://sandbox.sslcommerz.com/pay", provider_payment_id="S1"
        ),
    )
    payment = start(student, package, gateway=account_a.slug, channel="web")
    forged = _sign(
        {"tran_id": payment.merchant_reference, "val_id": "V-FORGED", "status": "VALID"},
        "password-of-account-b",
    )
    result = services.process_callback("sslcommerz", "success", forged)
    assert result is not None and result.status != PaymentStatus.SUCCESS
    assert validations == []  # the provider was never even asked: the signature came first
    assert not Subscription.objects.filter(user=student).exists()
    event = PaymentEvent.objects.filter(payment=payment).order_by("-id").first()
    assert event.payload.get("signature_valid") is False


def test_a_tampered_callback_field_breaks_the_signature(ctx, student, package, monkeypatch):
    make_tester(student, ctx.actor)
    from apps.payments.gateways import sslcommerz

    account = _ssl_gateway(ctx, "ssl-t", "password-of-account-t")
    monkeypatch.setattr(sslcommerz.SslCommerzGateway, "_get", lambda *a, **k: {"status": "VALID"})
    monkeypatch.setattr(
        sslcommerz.SslCommerzGateway,
        "initiate",
        lambda self, payment, urls, customer: sslcommerz.InitiateResult(
            checkout_url="https://sandbox.sslcommerz.com/pay", provider_payment_id="S2"
        ),
    )
    payment = start(student, package, gateway=account.slug, channel="web")
    good = _sign(
        {"tran_id": payment.merchant_reference, "val_id": "V1", "amount": "1.00"},
        "password-of-account-t",
    )
    good["amount"] = "500.00"  # the attacker edits a field after signing
    result = services.process_callback("sslcommerz", "success", good)
    assert result.status != PaymentStatus.SUCCESS


def test_a_callback_posted_to_the_wrong_provider_url_is_not_applied(ctx, student, package, bkash):
    """A bKash payment's reference sent to the SSLCommerz callback URL (or the reverse) is
    treated as an unknown reference."""
    make_tester(student, ctx.actor)
    gateway = make_gateway(ctx)
    payment = start(student, package, gateway=gateway.slug, channel="web")
    assert (
        services.process_callback("sslcommerz", "success", {"tran_id": payment.merchant_reference})
        is None
    )
    assert (
        services.process_callback("mock", "success", {"tran_id": payment.merchant_reference})
        is None
    )
    assert Payment.objects.get(pk=payment.pk).status == PaymentStatus.PENDING


def test_a_callback_for_a_disabled_gateway_still_settles_an_old_payment(
    ctx, student, package, bkash
):
    """Turning a gateway off must not strand money already on its way."""
    make_tester(student, ctx.actor)
    gateway = make_gateway(ctx)
    payment = start(student, package, gateway=gateway.slug, channel="web")
    PaymentGateway.objects.filter(pk=gateway.pk).update(enabled=False)
    paid = pay_success(Payment.objects.get(pk=payment.pk), bkash, trx="LATE")
    assert paid.status == PaymentStatus.SUCCESS


def test_amount_and_currency_come_from_us_not_from_the_provider_answer(
    ctx, student, package, bkash
):
    make_tester(student, ctx.actor)
    gateway = make_gateway(ctx)
    payment = start(student, package, gateway=gateway.slug, channel="web")
    bkash.status = "Completed"
    bkash.extra = {
        "trxID": "CHEAP",
        "amount": "1.00",  # the customer paid one taka
        "currency": payment.currency,
        "merchantInvoiceNumber": payment.merchant_reference,
        "paymentID": payment.provider_payment_id,
    }
    result = services._query(Payment.objects.get(pk=payment.pk))
    updated = services.apply_verification(payment.pk, result, source="test")
    assert updated.status != PaymentStatus.SUCCESS
    assert not Subscription.objects.filter(user=student).exists()


def test_a_provider_cannot_pay_for_someone_elses_payment(ctx, student, package, bkash):
    make_tester(student, ctx.actor)
    gateway = make_gateway(ctx)
    mine = start(student, package, gateway=gateway.slug, channel="web")
    other_student = User.objects.create_user(
        "01712345678", password=PASSWORD, full_name="Other", role=Role.STUDENT
    )
    make_tester(other_student, ctx.actor)
    theirs = start(other_student, package, gateway=gateway.slug, channel="web")
    # The provider answers "paid" for MY reference but with THEIR payment id.
    bkash.status = "Completed"
    bkash.extra = {
        "trxID": "MIX",
        "amount": f"{mine.amount:.2f}",
        "currency": mine.currency,
        "merchantInvoiceNumber": theirs.merchant_reference,
        "paymentID": mine.provider_payment_id,
    }
    result = services._query(Payment.objects.get(pk=mine.pk))
    services.apply_verification(mine.pk, result, source="test")
    assert not Subscription.objects.filter(user=student).exists()
    assert not Subscription.objects.filter(user=other_student).exists()


def test_the_same_provider_transaction_cannot_pay_two_payments(ctx, student, package, bkash):
    make_tester(student, ctx.actor)
    gateway = make_gateway(ctx)
    first = start(student, package, gateway=gateway.slug, channel="web", idempotency_key="k-one")
    second = start(student, package, gateway=gateway.slug, channel="web", idempotency_key="k-two")
    pay_success(first, bkash, trx="SAMETRX")
    bkash.status = "Completed"
    bkash.extra = {
        "trxID": "SAMETRX",
        "amount": f"{second.amount:.2f}",
        "currency": second.currency,
        "merchantInvoiceNumber": second.merchant_reference,
        "paymentID": second.provider_payment_id,
    }
    result = services._query(Payment.objects.get(pk=second.pk))
    services.apply_verification(second.pk, result, source="test")
    assert Payment.objects.get(pk=second.pk).status != PaymentStatus.SUCCESS
    assert Subscription.objects.filter(user=student).count() == 1


# ======================================================================================
# 7. Races
# ======================================================================================
@pytest.mark.django_db(transaction=True)
def test_many_simultaneous_confirmations_grant_exactly_once(ctx, student, package, bkash):
    make_tester(student, ctx.actor)
    gateway = make_gateway(ctx)
    payment = start(student, package, gateway=gateway.slug, channel="web")
    bkash.status = "Completed"
    bkash.extra = {
        "trxID": "RACE1",
        "amount": f"{payment.amount:.2f}",
        "currency": payment.currency,
        "merchantInvoiceNumber": payment.merchant_reference,
        "paymentID": payment.provider_payment_id,
    }
    errors = []

    def confirm():
        from django.db import connection as conn

        try:
            result = services._query(Payment.objects.get(pk=payment.pk))
            services.apply_verification(payment.pk, result, source="race")
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            conn.close()

    threads = [threading.Thread(target=confirm) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors, errors
    assert Subscription.objects.filter(user=student).count() == 1
    assert Payment.objects.get(pk=payment.pk).status == PaymentStatus.SUCCESS


@pytest.mark.django_db(transaction=True)
def test_a_double_click_with_one_key_opens_one_payment(ctx, student, package, bkash):
    make_tester(student, ctx.actor)
    gateway = make_gateway(ctx)
    outcomes = []

    def click():
        from django.db import connection as conn

        try:
            outcomes.append(
                start(
                    student,
                    package,
                    gateway=gateway.slug,
                    channel="web",
                    idempotency_key="same-click",
                )
            )
        except Exception as exc:  # noqa: BLE001
            outcomes.append(exc)
        finally:
            conn.close()

    threads = [threading.Thread(target=click) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert Payment.objects.filter(user=student).count() == 1, outcomes


@pytest.mark.django_db(transaction=True)
def test_simultaneous_credential_saves_keep_one_row_per_field(ctx, admin_user):
    gateway = make_gateway(ctx, creds=None)
    errors = []

    def save(value):
        from django.db import connection as conn

        try:
            gateway_store.save_credentials(gateway, "sandbox", {"app_key": value}, ctx=ctx)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            conn.close()

    threads = [threading.Thread(target=save, args=(f"value-{i:04d}",)) for i in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors, errors
    assert (
        PaymentGatewayCredential.objects.filter(
            gateway=gateway, mode="sandbox", field="app_key"
        ).count()
        == 1
    )


# ======================================================================================
# 8. Money amounts and limits
# ======================================================================================
def test_gateway_limits_are_exact_decimals(ctx, student, package):
    make_tester(student, ctx.actor)  # the gateway is in sandbox mode: testers only
    make_gateway(ctx, min_amount=Decimal("500.00"), max_amount=Decimal("500.00"))
    offers = gateway_manager.available_offers(
        student, "web", amount=Decimal("500.00"), currency="BDT"
    )
    assert len(offers) == 1
    assert not gateway_manager.available_offers(
        student, "web", amount=Decimal("499.99"), currency="BDT"
    )
    assert not gateway_manager.available_offers(
        student, "web", amount=Decimal("500.01"), currency="BDT"
    )


# ======================================================================================
# 9. The method list cannot be used to grind the server
# ======================================================================================
def test_the_method_list_is_limited_per_student(settings, student, ctx):
    settings.AUTH_THROTTLE_RATES = {**settings.AUTH_THROTTLE_RATES, "payment_methods": "3/minute"}
    make_gateway(ctx)
    client = jwt_client(student)
    codes = [client.get("/api/v1/payments/methods/").status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    # Another student has a budget of their own.
    other = User.objects.create_user(
        "01755550000", password=PASSWORD, full_name="O", role=Role.STUDENT
    )
    assert jwt_client(other).get("/api/v1/payments/methods/").status_code == 200
