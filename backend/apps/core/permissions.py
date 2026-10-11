"""Shared DRF permission classes."""

from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    """Allow only active, authenticated users with the ``admin`` role.

    Checked on every request (role or active flag changes take effect immediately).
    Anonymous → 401 (via the view's authenticator); authenticated non-admin → 403.
    """

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(
            user and user.is_authenticated and user.is_active and getattr(user, "is_admin", False)
        )
