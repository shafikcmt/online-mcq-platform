import { api } from "@/api/client";

/** Sample participants: invented examinees an admin added to an exam. Always labelled as sample, shown
 * apart from real students, with no rank, and never part of the real merit list or any statistic. */
/** `position_by_marks`: where these marks would stand in the real merit list (a comparison only;
 * null or absent when there is no merit list or the server is older). */
export type SampleRow = { name: string; marks: string; percentage: string; is_sample: true; position_by_marks?: number | null };
export type SampleList = { count: number; total_marks: string; results: SampleRow[] };
export type Participation = { real_count: number; sample_count: number; total_count: number };

/** Empty (never an error) when there are none or they are not visible yet. */
export async function fetchSamples(slug: string): Promise<SampleList | null> {
  try {
    const list = await api<SampleList>(`/public/exams/${encodeURIComponent(slug)}/sample-participants/`, { auth: false });
    return list.count > 0 ? list : null;
  } catch {
    return null;
  }
}

/** Null when it cannot be loaded: the screen then shows no participant line. */
export async function fetchParticipation(slug: string): Promise<Participation | null> {
  try {
    return await api<Participation>(`/public/exams/${encodeURIComponent(slug)}/participation/`, { auth: false });
  } catch {
    return null;
  }
}
