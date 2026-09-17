import { z } from 'zod';
/** Safe filename stem for operator-provisioned reviewed source records. */
export const REVIEW_REFERENCE_PATTERN = '[A-Za-z0-9][A-Za-z0-9_\\-]{0,127}';
export const ReviewReference = z.string().regex(new RegExp(`^${REVIEW_REFERENCE_PATTERN}$`));
