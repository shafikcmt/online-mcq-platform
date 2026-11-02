from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.db import transaction
from django.utils.translation import gettext_lazy as _


class UserManager(BaseUserManager):
    """Creates users with a mobile number as the login identity.

    Passwords always go through ``set_password`` (hashed, never stored in plain text).
    ``password=None`` creates an account with an *unusable* password.
    """

    use_in_migrations = True

    def _create_user(self, mobile_number, password, **extra_fields):
        if not mobile_number:
            raise ValueError(_("A mobile number is required."))

        user = self.model(mobile_number=mobile_number, **extra_fields)
        user.set_password(password)
        # Validates and normalizes every field (mobile number, email, role, language)
        # and checks uniqueness before touching the database.
        user.full_clean()

        with transaction.atomic(using=self._db):
            user.save(using=self._db)
            user.ensure_student_profile()
        return user

    def create_user(self, mobile_number, password=None, **extra_fields):
        from .models import Role

        extra_fields.setdefault("role", Role.STUDENT)
        extra_fields.setdefault("preferred_language", settings.LANGUAGE_CODE)
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(mobile_number, password, **extra_fields)

    def create_superuser(self, mobile_number, password=None, **extra_fields):
        from .models import Role

        extra_fields.setdefault("role", Role.ADMIN)
        extra_fields.setdefault("preferred_language", settings.ADMIN_DEFAULT_LANGUAGE)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError(_("Superuser must have is_staff=True."))
        if extra_fields.get("is_superuser") is not True:
            raise ValueError(_("Superuser must have is_superuser=True."))
        if extra_fields.get("role") != Role.ADMIN:
            raise ValueError(_("Superuser must have the admin role."))
        if not password:
            raise ValueError(_("Superuser must have a password."))
        return self._create_user(mobile_number, password, **extra_fields)
