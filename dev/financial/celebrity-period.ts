import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { ApprovedPeriodFile, ApprovalContext } from '@/server/adapters/approved-period/schema';

/** Synthetic business inputs for the owner's trial, never a production approval source. */
export function celebrityPeriod(partnerId = 'preview-partner') {
  const period = {
    from: '2026-07-01T00:00:00+07:00',
    toExclusive: '2026-09-01T00:00:00+07:00',
    timezone: 'Asia/Bangkok' as const,
  };
  // Literal source/finance controls, not calculated by the importer or from the rows below.
  const source = {
    id: 'synthetic-approved-export',
    account: 'labsd-demo',
    authority: 'synthetic-sales',
    canonicalAccount: 'labsd-demo',
    revision: 'snapshot-1',
    asOf: '2026-09-01T12:00:00+07:00',
    controls: {
      rows: 6,
      included: 6,
      excluded: 0,
      unresolved: 0,
      eligibleBaseMinor: '55000000',
      amountMinor: '3736000',
    },
  };
  const inputs = [
    ['clip-1', 'organic', '12800000', 100000, '1280000', '2026-08-30'],
    ['clip-2', 'brand-ads', '10400000', 30000, '312000', '2026-08-27'],
    ['clip-3', 'organic', '9600000', 100000, '960000', '2026-08-24'],
    ['clip-4', 'brand-ads', '8600000', 30000, '258000', '2026-08-21'],
    ['clip-5', 'organic', '7400000', 100000, '740000', '2026-08-18'],
    ['clip-6', 'brand-ads', '6200000', 30000, '186000', '2026-08-15'],
  ] as const;
  const rows: z.infer<typeof ApprovedPeriodFile>['rows'] = inputs.map(
    ([clip, channel, base, rate, amount, date]) => ({
      entitlement: {
        authority: source.authority,
        account: source.canonicalAccount,
        reference: 'demo-right-' + clip,
        line: null,
        right: channel,
      },
      sourceId: source.id,
      sourceAccount: source.account,
      sourceRevision: 'row-1',
      earnedAt: date + 'T12:00:00+07:00',
      evidenceRef: 'demo-evidence-' + clip,
      disposition: 'included',
      agreementVersion: 'synthetic-agreement-1',
      attribution: { kind: 'content', contentId: clip, evidenceRef: 'demo-mapping-' + clip },
      earning: {
        kind: 'commission',
        groupRef: channel,
        sku: 'demo-supplement',
        channel,
        baseMinor: base,
        ratePpm: rate,
        amountMinor: amount,
      },
    }),
  );
  const file = ApprovedPeriodFile.parse({
    schema: 'approved-period/1',
    mode: 'complete-snapshot',
    partnerId,
    period,
    currency: 'THB',
    sources: [source],
    rows,
  });
  const raw = JSON.stringify(file);
  const context = ApprovalContext.parse({
    fileSha256: createHash('sha256').update(raw).digest('hex'),
    approvalRef: 'synthetic-finance-review-1',
    partnerId,
    period,
    currency: 'THB',
    sources: [source],
    groups: [
      {
        id: 'organic',
        right: 'organic',
        ratePpm: 100000,
        baseMinor: '29800000',
        amountMinor: '2980000',
      },
      {
        id: 'brand-ads',
        right: 'brand-ads',
        ratePpm: 30000,
        baseMinor: '25200000',
        amountMinor: '756000',
      },
    ].map((group) => ({
      ...group,
      agreementVersion: 'synthetic-agreement-1',
      agreementEvidenceRef: 'synthetic-deal',
      policyRef: 'synthetic-base-policy',
      effective: period,
      calculationWindow: period,
      rounding: { mode: 'per-line', tieBreak: 'half-away-from-zero', allocation: 'none' },
      skus: ['demo-supplement'],
      channels: [group.id],
      rows: 3,
    })),
    amounts: [],
    exclusions: [],
    attributions: rows.map((row) => ({
      entitlement: row.entitlement,
      contentId:
        row.disposition === 'included' && row.attribution.kind === 'content'
          ? row.attribution.contentId
          : '',
      evidenceRef:
        'demo-mapping-' +
        (row.disposition === 'included' && row.attribution.kind === 'content'
          ? row.attribution.contentId
          : ''),
    })),
  });
  return { raw, file, context };
}
