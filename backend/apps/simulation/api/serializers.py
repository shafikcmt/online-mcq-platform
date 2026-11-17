"""Sample participant serializers. Public output always says what these are (``is_sample`` is
true on every row) and carries no ids, ranks or account data."""

from rest_framework import serializers

from ..models import MAX_ENTRIES_PER_EXAM, MAX_NAMES_PER_BATCH, NAME_MAX_LENGTH, SamplePerson


class SamplePersonSerializer(serializers.ModelSerializer):
    name = serializers.CharField(max_length=NAME_MAX_LENGTH, trim_whitespace=False)
    is_active = serializers.BooleanField(required=False)
    exam_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = SamplePerson
        fields = ("id", "name", "is_active", "exam_count", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class BulkNamesSerializer(serializers.Serializer):
    """``POST``: many names at once (one per line in the admin form)."""

    names = serializers.ListField(
        child=serializers.CharField(
            max_length=NAME_MAX_LENGTH, allow_blank=True, trim_whitespace=False
        ),
        min_length=1,
        max_length=MAX_NAMES_PER_BATCH,
    )


class BulkNamesResultSerializer(serializers.Serializer):
    created = serializers.IntegerField()
    skipped = serializers.IntegerField(help_text="Names already in the list (or repeated).")


class EntryInSerializer(serializers.Serializer):
    person = serializers.IntegerField(min_value=1)
    marks = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=0)


class EntryOutSerializer(serializers.Serializer):
    person = serializers.IntegerField()
    name = serializers.CharField()
    is_active = serializers.BooleanField()
    marks = serializers.DecimalField(max_digits=8, decimal_places=2)


class EntryListSerializer(serializers.Serializer):
    """``PUT``: the COMPLETE list of the exam's sample participants."""

    entries = EntryInSerializer(many=True, max_length=MAX_ENTRIES_PER_EXAM + 1)


class EntryListOutSerializer(serializers.Serializer):
    entries = EntryOutSerializer(many=True)
    total_marks = serializers.DecimalField(max_digits=10, decimal_places=2)


class PublicSampleRowSerializer(serializers.Serializer):
    name = serializers.CharField()
    marks = serializers.DecimalField(max_digits=8, decimal_places=2)
    percentage = serializers.CharField()
    is_sample = serializers.BooleanField(help_text="Always true: these are not real students.")
    position_by_marks = serializers.IntegerField(
        allow_null=True,
        help_text="Where these marks would stand in the real merit list (a comparison only; "
        "the sample participant is not in that list). Null until a merit list exists.",
    )


class PublicSampleListSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    total_marks = serializers.DecimalField(max_digits=10, decimal_places=2)
    results = PublicSampleRowSerializer(many=True)


class ParticipationSerializer(serializers.Serializer):
    real_count = serializers.IntegerField(help_text="Real students who started the exam.")
    sample_count = serializers.IntegerField(help_text="Sample participants added by the admin.")
    total_count = serializers.IntegerField(help_text="real_count + sample_count.")
