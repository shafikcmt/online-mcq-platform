import { MaterialsView } from "@/components/materials/materials-view";
import { adminList, adminLookup } from "@/lib/api/lists";
import { MATERIAL_LIST } from "@/lib/content-specs";
import { titleMetadata } from "@/lib/i18n/metadata";
import { parseListParams } from "@/lib/list-params";
import type { ExamOption } from "@/components/materials/material-form-dialog";
import type { Category, Subject } from "@/types/content";
import type { Material } from "@/types/materials";

export const generateMetadata = () => titleMetadata("mat.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MaterialsPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseListParams(await searchParams, MATERIAL_LIST);
  const [data, categories, subjects, exams] = await Promise.all([
    adminList<Material>("/admin/materials/", state, MATERIAL_LIST, "/materials"),
    adminLookup<Category>("/admin/categories/"),
    adminLookup<Subject>("/admin/subjects/"),
    adminLookup<ExamOption>("/admin/exams/", "", "-created_at"),
  ]);
  return <MaterialsView data={data} state={state} lookups={{ categories: categories.rows, subjects: subjects.rows, exams: exams.rows }} />;
}
