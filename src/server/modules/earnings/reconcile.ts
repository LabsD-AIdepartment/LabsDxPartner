import type { z } from 'zod';
import { AgreementVersion, Rate } from '@/contracts/earnings';
import { allocatePeriod, commission, sumMinor } from './calculate';
export function calculateAgreementGroup(input: {
  agreement: z.infer<typeof AgreementVersion>;
  ratePpm: number;
  lines: readonly { id: string; base: bigint }[];
}) {
  const agreement = AgreementVersion.parse(input.agreement);
  const rate = Rate.parse(input.ratePpm);
  if (new Set(input.lines.map((x) => x.id)).size !== input.lines.length)
    throw new Error('Duplicate entitlement ID');
  const rows =
    agreement.roundingRule.mode === 'per-period'
      ? allocatePeriod(input.lines, rate)
      : Object.fromEntries(input.lines.map((x) => [x.id, commission(x.base, rate)]));
  return { agreementVersion: agreement.id, rows, total: sumMinor(Object.values(rows)) };
}
