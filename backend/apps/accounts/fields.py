from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.core.phone import normalize_bd_mobile, try_normalize_bd_mobile


class MobileNumberField(models.CharField):
    """Stores Bangladeshi mobile numbers in one canonical form: ``+8801XXXXXXXXX``.

    - ``to_python`` (forms, ``full_clean``, ``createsuperuser``) normalizes or raises
      a ``ValidationError``.
    - ``pre_save`` / ``get_prep_value`` normalize on every save **and lookup**, so
      ``User.objects.get(mobile_number="01712345678")`` and authentication with any
      accepted input form find the same user.
    """

    description = _("Bangladeshi mobile number")

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("max_length", 20)
        super().__init__(*args, **kwargs)

    def to_python(self, value):
        value = super().to_python(value)
        if value in self.empty_values:
            return value
        return normalize_bd_mobile(value)

    def pre_save(self, model_instance, add):
        value = getattr(model_instance, self.attname)
        if value not in self.empty_values:
            value = try_normalize_bd_mobile(value)
            setattr(model_instance, self.attname, value)
        return value

    def get_prep_value(self, value):
        # Skip CharField.get_prep_value: it calls to_python(), which would raise on an
        # invalid number. A lookup with an invalid number must simply match nothing.
        value = models.Field.get_prep_value(self, value)
        if value in self.empty_values:
            return value
        return try_normalize_bd_mobile(str(value))
