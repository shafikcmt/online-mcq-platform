/** Read-only audit log (GET /admin/audit-logs/). Entries are written by the services in
 * the same transaction as the change; metadata is allow-listed there (no secrets). */
export type AuditEntry = {
  id: number;
  created_at: string;
  /** null for system jobs. */
  actor: number | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
};

/** Every action the services record (filter values; unknown ones are still listed). */
export const AUDIT_ACTIONS = [
  "admin.login",
  "category.create", "category.update", "category.delete",
  "subject.create", "subject.update", "subject.delete",
  "question.create", "question.update", "question.delete",
  "exam.create", "exam.update", "exam.delete", "exam.duplicate", "exam.questions_update",
  "exam.publish", "exam.unpublish", "exam.archive",
  "exam.results_publish", "exam.results_hide", "exam.merit_generate",
  "package.create", "package.update", "package.delete", "package.access_rules_update",
  "subscription.grant", "subscription.extend", "subscription.cancel",
  "payment.reverify", "payment.late_success_recover",
  "announcement.create", "announcement.update", "announcement.delete",
  "faq.create", "faq.update", "faq.delete",
  "page.create", "page.update", "page.delete",
  "contact_message.status", "site_settings.update",
] as const;

export const AUDIT_ENTITY_TYPES = [
  "accounts.user",
  "catalog.category",
  "catalog.subject",
  "questions.question",
  "exams.exam",
  "subscriptions.package",
  "subscriptions.subscription",
  "payments.payment",
  "cms.announcement",
  "cms.faq",
  "cms.page",
  "cms.contactmessage",
  "cms.sitesettings",
] as const;
