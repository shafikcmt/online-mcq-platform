"""System checks: protection that must never be silently disabled."""

from django.apps import apps
from django.core import checks

from .locks import CONTENT, has_checks


@checks.register()
def question_locks_registered(app_configs=None, **kwargs):
    """If any other model references questions (e.g. exam questions, attempt answers),
    a content lock must be registered — otherwise used questions could be edited."""
    from .models import Question, QuestionOption

    dependants = [
        f"{model._meta.label}.{field.name}"
        for model in apps.get_models()
        if model is not QuestionOption
        for field in model._meta.get_fields()
        if getattr(field, "related_model", None) is Question
        and getattr(field, "many_to_one", False)
        and field.concrete
    ]
    if dependants and not has_checks(CONTENT):
        return [
            checks.Error(
                "Questions are referenced by other models but no question edit lock is registered.",
                hint="Register one in the dependent app's AppConfig.ready() with "
                "apps.questions.locks.register_edit_lock(). References: " + ", ".join(dependants),
                id="questions.E001",
            )
        ]
    return []
