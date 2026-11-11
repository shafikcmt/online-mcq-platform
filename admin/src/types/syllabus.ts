/** An exam's syllabus (apps/exams): `GET`/`PUT /admin/exams/{id}/syllabus/`. The server keeps the
 * list in the order sent; every line has a subject, a chapter and/or a topic (free text). */
export type SyllabusLineData = { subject: string; chapter: string; topic: string };
export type SyllabusResponse = { syllabus: SyllabusLineData[] };
