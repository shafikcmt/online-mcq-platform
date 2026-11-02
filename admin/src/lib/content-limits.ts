/** Field length limits of the content API (column sizes, not business rules), mirrored
 * from the backend models so the forms can show counters and stop typing at the limit.
 * The server still validates everything. Configurable rules (minimum/maximum number of
 * options, image size) are NOT copied here: the server's message is shown instead. */
export const NAME_MAX_LENGTH = 120; // apps/catalog/models.py
export const SLUG_MAX_LENGTH = 140;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const QUESTION_TEXT_MAX_LENGTH = 5000; // apps/questions/models.py
export const EXPLANATION_MAX_LENGTH = 5000;
export const OPTION_TEXT_MAX_LENGTH = 1000;
export const MAX_SORT_ORDER = 2_147_483_647;
export const EXAM_TITLE_MAX_LENGTH = 200; // apps/exams/models.py
export const EXAM_TEXT_MAX_LENGTH = 5000;
