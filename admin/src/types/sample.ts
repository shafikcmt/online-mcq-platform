/** Sample participants (apps/simulation/api/serializers.py). Invented examinees, always labelled as
 * sample in every client and kept apart from real students, results and statistics. */
export type SamplePerson = {
  id: number;
  name: string;
  is_active: boolean;
  /** In how many exams this person is a participant. */
  exam_count: number;
  created_at: string;
  updated_at: string;
};

export type SampleEntry = { person: number; name: string; is_active: boolean; marks: string };
export type SampleEntriesResponse = { total_marks: string; entries: SampleEntry[] };

/** At most this many names in one "add many" request (the server's limit). */
export const SAMPLE_BATCH_MAX = 200;
export const SAMPLE_NAME_MAX = 120;
export const SAMPLE_MAX_PER_EXAM = 500;
