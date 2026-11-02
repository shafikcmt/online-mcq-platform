import { Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";

import { PageIntro } from "@/components/cards";
import { ContactForm } from "@/components/contact-form";
import { getSettings } from "@/lib/api";
import { isLang, translator, type Lang } from "@/lib/i18n";
import { alternates } from "@/lib/site";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = translator(lang);
  return { title: t("meta.contactTitle"), description: t("meta.contactDescription"), alternates: alternates(lang, "/contact") };
}

/** Contact: the contact details from the Admin Panel → Site settings (only those set) and
 * the contact form (messages land in the Admin Panel → Contact messages). */
export default async function ContactPage({ params }: { params: Promise<{ lang: string }> }) {
  const lang = (await params).lang as Lang;
  const t = translator(lang);
  const settings = await getSettings(lang);
  const details = [
    settings?.contact_phone ? { icon: Phone, label: t("contact.phone"), value: settings.contact_phone, href: `tel:${settings.contact_phone.replace(/[^\d+]/g, "")}` } : null,
    settings?.contact_email ? { icon: Mail, label: t("contact.email"), value: settings.contact_email, href: `mailto:${settings.contact_email}` } : null,
    settings?.address ? { icon: MapPin, label: t("contact.address"), value: settings.address, href: null } : null,
  ].filter((item) => item !== null);
  const keys = [
    "name", "phoneField", "emailField", "either", "requiredNote", "subject", "message", "honeypot", "send", "sending",
    "required", "needContact", "invalidEmail", "sent", "another", "fix", "throttled", "failed",
  ] as const;
  const labels = Object.fromEntries(keys.map((key) => [key, t(`contact.${key}`)])) as Record<(typeof keys)[number], string>;

  return (
    <>
      <PageIntro title={t("contact.title")} body={t("contact.body")} />
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="contact-form" className="rounded-card border border-line bg-surface p-6 shadow-sm">
          <h2 id="contact-form" className="mb-4 text-lg font-semibold text-ink">
            {t("contact.form")}
          </h2>
          <noscript>
            <p className="mb-4 text-sm text-warning-700">{t("contact.noscript")}</p>
          </noscript>
          <ContactForm lang={lang} labels={labels} />
        </section>
        {details.length ? (
          <aside aria-labelledby="contact-details" className="lg:self-start">
            <h2 id="contact-details" className="mb-4 text-lg font-semibold text-ink">
              {t("contact.details")}
            </h2>
            <ul className="flex flex-col gap-3">
              {details.map(({ icon: Icon, label, value, href }) => (
                <li key={label} className="flex items-start gap-3 rounded-card border border-line bg-surface p-4">
                  <Icon className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink-subtle">{label}</p>
                    {href ? (
                      <a href={href} className="break-words font-medium text-ink hover:text-brand-700">
                        {value}
                      </a>
                    ) : (
                      <p className="whitespace-pre-line break-words font-medium text-ink">{value}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </>
  );
}
