"""Read side of results: the visibility policy, answer review, leaderboard names.

One policy decides whether a student may see results (``results_visible``); every
result, review and leaderboard endpoint goes through it. A result row may exist long
before it is visible — existence alone never reveals a score.

Visibility (``exams.result_visibility``):
- ``immediate``      — as soon as the attempt is finished;
- ``after_exam_end`` — from the exam's ``end_at`` on (such exams always have an
  ``end_at``: enforced by ``exams.services`` and a database CHECK);
- ``manual``         — once an admin publishes (``result_published_at``).
Publishing makes results visible in any mode; hiding withdraws only the publication.

Answer review additionally needs ``exam.allow_answer_review``.
"""

import unicodedata
from datetime import datetime

from django.db.models import Count, OuterRef, Prefetch, Q, Subquery
from django.db.models.functions import Coalesce

from apps.attempts.models import AttemptAnswer, ExamAttempt
from apps.cms import selectors as cms
from apps.cms.models import LeaderboardNameMode
from apps.core.i18n import resolve_bilingual
from apps.exams.models import ContentLanguage, Exam, ResultVisibility
from apps.questions.models import QuestionOption

from .models import Result

# The single list of modes lives with the site settings that choose between them.
NAME_MODES = tuple(LeaderboardNameMode.values)


# --------------------------------------------------------------------------------------
# Visibility
# --------------------------------------------------------------------------------------
def results_visible(exam: Exam, now: datetime) -> bool:
    if exam.result_published_at is not None and exam.result_published_at <= now:
        return True
    if exam.result_visibility == ResultVisibility.IMMEDIATE:
        return True
    if exam.result_visibility == ResultVisibility.AFTER_EXAM_END:
        return exam.end_at is not None and now >= exam.end_at
    return False  # manual, not published


def visible_exams_filter(now: datetime, prefix: str = "") -> Q:
    """``results_visible`` as a query filter on exams (``prefix="exam__"`` on results)."""
    return (
        Q(**{f"{prefix}result_published_at__lte": now})
        | Q(**{f"{prefix}result_visibility": ResultVisibility.IMMEDIATE})
        | Q(
            **{
                f"{prefix}result_visibility": ResultVisibility.AFTER_EXAM_END,
                f"{prefix}end_at__lte": now,
            }
        )
    )


def visible_results_filter(now: datetime) -> Q:
    """``results_visible`` as a query filter on results (same policy, for lists)."""
    return visible_exams_filter(now, prefix="exam__")


def public_leaderboard_exams(exams, now: datetime):
    """The exams among ``exams`` whose merit list the public leaderboard shows: merit
    enabled, results visible (the same policy as ``results_visible``) and a generated
    merit list — annotated with ``ranked_count``."""
    ranked = (
        Result.objects.filter(exam_id=OuterRef("pk"), is_merit_counted=True)
        .exclude(merit_position=None)
        .order_by()
        .values("exam_id")
        .annotate(n=Count("id"))
        .values("n")
    )
    return (
        exams.filter(merit_enabled=True)
        .filter(visible_exams_filter(now))
        .annotate(ranked_count=Coalesce(Subquery(ranked), 0))
        .filter(ranked_count__gt=0)
    )


def user_can_view_result(result: Result, user, now: datetime) -> bool:
    return result.user_id == user.pk and results_visible(result.exam, now)


def review_allowed(result: Result, user, now: datetime) -> bool:
    return user_can_view_result(result, user, now) and result.exam.allow_answer_review


def own_results(user):
    return Result.objects.filter(user_id=user.pk).select_related("exam", "attempt")


# --------------------------------------------------------------------------------------
# Leaderboard names (phone/email are never used)
# --------------------------------------------------------------------------------------
def _visible_prefix(word: str, length: int) -> str:
    """First ``length`` characters, extended over combining marks so Bangla
    conjuncts/vowel signs are not cut in half."""
    end = min(length, len(word))
    while end < len(word) and unicodedata.category(word[end]) in ("Mn", "Mc"):
        end += 1
    return word[:end]


def masked_name(full_name: str) -> str:
    """``Rahim Hossain`` → ``Rah*** H.``; ``Ali`` → ``Al***``."""
    words = full_name.split()
    if not words:
        return "***"
    first = words[0]
    shown = _visible_prefix(first, max(1, min(3, len(first) - 1)))
    name = f"{shown}***"
    if len(words) > 1:
        name += f" {_visible_prefix(words[-1], 1)}."
    return name


def initials(full_name: str) -> str:
    words = full_name.split()
    if not words:
        return "***"
    return " ".join(f"{_visible_prefix(word, 1)}." for word in (words[0], words[-1])[: len(words)])


def display_name_for(user, mode: str) -> str:
    full_name = user.full_name or ""
    if mode == "full_name":
        return full_name or masked_name(full_name)
    if mode == "initials":
        return initials(full_name)
    if mode == "display_name":
        profile = getattr(user, "student_profile", None)
        nickname = getattr(profile, "display_name", "") if profile is not None else ""
        return nickname or masked_name(full_name)
    return masked_name(full_name)


def leaderboard_name_mode(channel: str) -> str:
    """``public`` (website) or ``app``: the admin's choice in the site settings
    (environment defaults until they are first saved); anything unknown → ``masked``."""
    value = cms.leaderboard_name_mode(channel)
    return value if value in NAME_MODES else "masked"


def ranked_results(exam: Exam):
    """The generated merit list (positions filled by merit generation)."""
    return (
        Result.objects.filter(exam_id=exam.pk, is_merit_counted=True, merit_position__isnull=False)
        .select_related("user", "user__student_profile")
        .order_by("merit_position")
    )


# --------------------------------------------------------------------------------------
# The question paper of a past exam (the archive)
# --------------------------------------------------------------------------------------
def paper_allowed(exam: Exam, now: datetime, *, entitled: bool) -> bool:
    """May a student read this exam's questions WITH the answers, without having taken it?

    Only when nobody can sit it any more and the answers are no longer a secret:
    - the exam has an end time and it has passed (an exam with no end can always be taken, so
      its answers are never shown here);
    - the admin allows answer review for it and its results are visible (``results_visible``);
    - the student is entitled to the exam (it is free, or their subscription covers it)."""
    over = exam.end_at is not None and exam.end_at <= now
    return bool(over and entitled and exam.allow_answer_review and results_visible(exam, now))


def paper_payload(exam: Exam, language: str, request=None) -> list[dict]:
    """The exam's questions in the admin's order, each with its options, the correct one, the
    marks and the explanation. Call only after ``paper_allowed``."""
    bilingual = exam.content_language == ContentLanguage.BOTH
    if not bilingual:
        language = exam.content_language  # the paper exists in one language only
    options = QuestionOption.objects.only(
        "id", "question_id", "text_bn", "text_en", "is_correct", "sort_order"
    )
    rows = (
        exam.exam_questions.select_related("question")
        .prefetch_related(Prefetch("question__options", queryset=options))
        .order_by("sort_order", "id")
    )
    items = []
    for number, row in enumerate(rows, start=1):
        question = row.question
        option_items = []
        correct_id = None
        for option in question.options.all():
            if option.is_correct:
                correct_id = option.pk
            entry = {
                "id": option.pk,
                "text": resolve_bilingual(option, "text", language)[0],
                "is_correct": option.is_correct,
            }
            if bilingual:
                entry.update(text_bn=option.text_bn, text_en=option.text_en)
            option_items.append(entry)
        image = None
        if question.image:
            image = question.image.url
            if request is not None:
                image = request.build_absolute_uri(image)
        item = {
            "question_id": question.pk,
            "number": number,
            "text": resolve_bilingual(question, "text", language)[0],
            "image": image,
            "options": option_items,
            "correct_option_id": correct_id,
            "marks": row.marks if row.marks is not None else exam.default_marks,
            "explanation": resolve_bilingual(question, "explanation", language)[0],
        }
        if bilingual:
            item.update(
                text_bn=question.text_bn,
                text_en=question.text_en,
                explanation_bn=question.explanation_bn,
                explanation_en=question.explanation_en,
            )
        items.append(item)
    return items


# --------------------------------------------------------------------------------------
# Answer review payload (only after ``review_allowed``)
# --------------------------------------------------------------------------------------
def review_payload(result: Result, request=None) -> list[dict]:
    """Questions in the student's own order with their answer, the correct option,
    correctness, awarded marks and the explanation."""
    attempt: ExamAttempt = result.attempt
    language = attempt.content_language
    bilingual = result.exam.content_language == ContentLanguage.BOTH
    options = QuestionOption.objects.only("id", "question_id", "text_bn", "text_en", "is_correct")
    answers = (
        AttemptAnswer.objects.filter(attempt_id=attempt.pk)
        .select_related("question")
        .prefetch_related(Prefetch("question__options", queryset=options))
        .order_by("display_order")
    )
    items = []
    for number, answer in enumerate(answers, start=1):
        question = answer.question
        by_id = {option.pk: option for option in question.options.all()}
        option_items = []
        correct_id = None
        for option_id in answer.option_order:
            option = by_id[option_id]
            if option.is_correct:
                correct_id = option.pk
            entry = {
                "id": option.pk,
                "text": resolve_bilingual(option, "text", language)[0],
                "is_correct": option.is_correct,
            }
            if bilingual:
                entry.update(text_bn=option.text_bn, text_en=option.text_en)
            option_items.append(entry)
        image = None
        if question.image:
            image = question.image.url
            if request is not None:
                image = request.build_absolute_uri(image)
        item = {
            "question_id": question.pk,
            "number": number,
            "text": resolve_bilingual(question, "text", language)[0],
            "image": image,
            "options": option_items,
            "selected_option_id": answer.selected_option_id,
            "correct_option_id": correct_id,
            "is_correct": answer.is_correct,
            "marks": answer.marks,
            "awarded_marks": answer.awarded_marks,
            "is_marked_for_review": answer.is_marked_for_review,
            "explanation": resolve_bilingual(question, "explanation", language)[0],
        }
        if bilingual:
            item.update(
                text_bn=question.text_bn,
                text_en=question.text_en,
                explanation_bn=question.explanation_bn,
                explanation_en=question.explanation_en,
            )
        items.append(item)
    return items
