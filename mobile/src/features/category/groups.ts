import { api } from "@/api/client";

/** `GET /public/groups/` — the shelves inside a category (and sub-groups inside a group): the
 * exams a student can see in each (`exam_count`, sub-groups included), how many scheduled exams
 * are running right now (`live_count`) and how many sub-groups it has. */
export type Group = {
  slug: string;
  name: string;
  description: string;
  exam_count: number;
  live_count: number;
  child_count: number;
};

/** `GET /public/groups/{slug}/` — one group with where it sits (for the title) and its sub-groups. */
export type GroupDetail = Group & {
  category: { slug: string; name: string };
  parent: { slug: string; name: string } | null;
  children: Group[];
};

/** A category's top-level groups, or (with `parent`) the sub-groups of a group. Groups with nothing
 * visible yet are left out: an empty shelf is never shown. */
export async function fetchGroups(category: string, parent?: string): Promise<Group[]> {
  const query = `category=${encodeURIComponent(category)}${parent ? `&parent=${encodeURIComponent(parent)}` : ""}&page_size=50`;
  const data = await api<{ results: Group[] }>(`/public/groups/?${query}`);
  return data.results.filter((group) => group.exam_count > 0);
}

export function fetchGroup(slug: string): Promise<GroupDetail> {
  return api<GroupDetail>(`/public/groups/${encodeURIComponent(slug)}/`);
}
