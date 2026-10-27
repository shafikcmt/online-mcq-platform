import { notFound } from "next/navigation";

/** Any other address under /bn or /en: the localized "not found" page (with the site's
 * header and footer) instead of the bare bilingual one. */
export default function Unknown() {
  notFound();
}
