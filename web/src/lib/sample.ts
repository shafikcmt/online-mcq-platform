/** Sample participants (`GET /api/v1/public/exams/<slug>/sample-participants/` and `…/participation/`).
 * Invented examinees an admin added: always labelled as sample, shown apart from real students, with no
 * rank, and never part of the real merit list or any statistic. */
/** `position_by_marks`: where these marks would stand in the real merit list (a comparison only;
 * null or absent when there is no merit list or the server is older). */
export type SampleRow = { name: string; marks: string; percentage: string; is_sample: true; position_by_marks?: number | null };
export type SampleList = { count: number; total_marks: string; results: SampleRow[] };
export type Participation = { real_count: number; sample_count: number; total_count: number };
