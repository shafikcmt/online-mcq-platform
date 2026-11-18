import type { CmsPage } from "@/lib/api";
import type { Lang, Messages } from "@/lib/i18n";

type Legal = Messages["legal"]["privacy"];

/** A written policy: the title, an introduction and numbered sections, shown as plain text (a line
 * starting with "•" is a list item; text is never treated as HTML). When an admin has written the page in
 * Admin Panel → Pages (slug `privacy` or `terms`), that text replaces ours, so the owner can have it
 * reviewed and worded as their lawyer wants without a new release. */
export function LegalBody({ legal, updated, page, lang }: { legal: Legal; updated: string; page: CmsPage | null; lang: Lang }) {
  return (
    <article className="max-w-3xl" lang={lang}>
      {page ? (
        <p className="whitespace-pre-line text-base leading-relaxed text-ink">{page.body}</p>
      ) : (
        <>
          <p className="text-lg leading-relaxed text-ink-muted">{legal.intro}</p>
          {legal.sections.map((section, index) => (
            <section key={section.title} aria-labelledby={`legal-${index}`} className="mt-8">
              <h2 id={`legal-${index}`} className="text-xl font-semibold text-ink">
                {section.title}
              </h2>
              <p className="mt-2 whitespace-pre-line leading-relaxed text-ink">{section.body}</p>
            </section>
          ))}
        </>
      )}
      <p className="mt-10 text-sm text-ink-subtle">{updated}</p>
    </article>
  );
}
