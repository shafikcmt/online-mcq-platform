"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { useI18n } from "@/lib/i18n/provider";

export function ExamNotFound() {
  const { t } = useI18n();
  return (
    <Card>
      <EmptyState
        title={t("error.notFound")}
        action={
          <Button asChild variant="secondary">
            <Link href="/exams">{t("exam.back")}</Link>
          </Button>
        }
      />
    </Card>
  );
}
