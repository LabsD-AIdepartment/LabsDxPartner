import { createHash } from 'node:crypto';
import { allocatePeriod, commission } from '@/server/modules/earnings/calculate';
import {
  ApprovalContext,
  ApprovedPeriodFile,
  entitlementKey,
  INTAKE_LIMITS,
  type IncludedRow,
} from './schema';

type IssueCode =
  | 'input_too_large'
  | 'invalid_json'
  | 'invalid_schema'
  | 'invalid_approval_context'
  | 'scope_mismatch'
  | 'source_mismatch'
  | 'duplicate_entitlement'
  | 'unapproved_exclusion'
  | 'unapproved_amount'
  | 'unapproved_attribution'
  | 'unapproved_rule'
  | 'outside_period'
  | 'control_mismatch'
  | 'calculation_mismatch'
  | 'incomplete_calculation_window'
  | 'snapshot_mismatch';
export type IntakeIssue = { code: IssueCode; row?: number };
export type DraftBlocker = { code: 'unresolved_row' | 'original_history_required'; row: number };
type Period = { from: string; toExclusive: string };
const time = (s: string) => Date.parse(s);
const samePeriod = (a: Period, b: Period) =>
  time(a.from) === time(b.from) && time(a.toExclusive) === time(b.toExclusive);
const contains = (p: Period, at: string) =>
  time(p.from) <= time(at) && time(at) < time(p.toExclusive);
const encloses = (outer: Period, inner: Period) =>
  time(outer.from) <= time(inner.from) && time(outer.toExclusive) >= time(inner.toExclusive);
const sourceKey = (id: string, account: string) => JSON.stringify([id, account]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Pure offline intake. Success is a validated DRAFT, never permission to publish. */
export function parseApprovedPeriod(raw: string, trustedContext: unknown) {
  const fail = (code: IssueCode, row?: number) => ({
    ok: false as const,
    issues: [{ code, ...(row === undefined ? {} : { row }) }] as IntakeIssue[],
  });
  if (Buffer.byteLength(raw, 'utf8') > INTAKE_LIMITS.bytes) return fail('input_too_large');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail('invalid_json');
  }
  // Zod array.max also visits every element. Refuse oversized collections before
  // validation can allocate an issue for each field in millions of tiny rows.
  if (
    value &&
    typeof value === 'object' &&
    'rows' in value &&
    Array.isArray(value.rows) &&
    value.rows.length > INTAKE_LIMITS.rows
  )
    return fail('invalid_schema');
  const parsed = ApprovedPeriodFile.safeParse(value);
  if (!parsed.success) return fail('invalid_schema');
  const approved = ApprovalContext.safeParse(trustedContext);
  if (!approved.success) return fail('invalid_approval_context');
  const file = parsed.data,
    context = approved.data;
  if (createHash('sha256').update(raw, 'utf8').digest('hex') !== context.fileSha256)
    return fail('snapshot_mismatch');
  if (file.partnerId !== context.partnerId || !samePeriod(file.period, context.period))
    return fail('scope_mismatch');
  const sources = new Map(context.sources.map((s) => [sourceKey(s.id, s.account), s]));
  const groups = new Map(context.groups.map((g) => [g.id, g]));
  const amounts = new Map(context.amounts.map((a) => [entitlementKey(a.entitlement), a]));
  const exclusions = new Map(context.exclusions.map((a) => [entitlementKey(a.entitlement), a]));
  const attributions = new Map(context.attributions.map((a) => [entitlementKey(a.entitlement), a]));
  if (
    sources.size !== context.sources.length ||
    groups.size !== context.groups.length ||
    amounts.size !== context.amounts.length ||
    exclusions.size !== context.exclusions.length ||
    attributions.size !== context.attributions.length
  )
    return fail('invalid_approval_context');
  for (const source of sources.values()) {
    if (time(source.asOf) < time(file.period.toExclusive)) return fail('source_mismatch');
  }
  // Context is still validated: a server programming error must not relax coverage.
  for (const group of groups.values()) {
    if (
      !encloses(file.period, group.calculationWindow) ||
      !encloses(group.effective, group.calculationWindow)
    )
      return fail('incomplete_calculation_window');
  }
  if (file.sources.length !== sources.size) return fail('source_mismatch');
  const manifestKeys = new Set<string>();
  for (const source of file.sources) {
    const key = sourceKey(source.id, source.account);
    if (manifestKeys.has(key) || !same(source, sources.get(key))) return fail('source_mismatch');
    manifestKeys.add(key);
  }
  const totals = new Map(
    [...sources.keys()].map((key) => [
      key,
      {
        rows: 0,
        included: 0,
        excluded: 0,
        unresolved: 0,
        base: 0n,
        amount: 0n,
      },
    ]),
  );
  const calculations = new Map<string, { key: string; index: number; row: IncludedRow }[]>();
  const seen = new Set<string>(),
    usedAmounts = new Set<string>(),
    usedExclusions = new Set<string>();
  const blockers: DraftBlocker[] = [];
  for (const [index, row] of file.rows.entries()) {
    const key = entitlementKey(row.entitlement);
    if (seen.has(key)) return fail('duplicate_entitlement', index);
    seen.add(key);
    const delivery = sourceKey(row.sourceId, row.sourceAccount),
      source = sources.get(delivery);
    if (
      !source ||
      row.entitlement.authority !== source.authority ||
      row.entitlement.account !== source.canonicalAccount
    )
      return fail('source_mismatch', index);
    if (!contains(file.period, row.earnedAt) || time(row.earnedAt) > time(source.asOf))
      return fail('outside_period', index);
    // Row revision is independent of the complete-snapshot revision; both are retained.
    const total = totals.get(delivery)!;
    total.rows++;
    total[row.disposition]++;
    if (row.disposition === 'unresolved') {
      blockers.push({ code: 'unresolved_row', row: index });
      continue;
    }
    if (row.disposition === 'excluded') {
      const exclusion = exclusions.get(key);
      if (
        !exclusion ||
        exclusion.reasonRef !== row.reasonRef ||
        exclusion.approvalRef !== row.approvalRef
      )
        return fail('unapproved_exclusion', index);
      usedExclusions.add(key);
      continue;
    }
    const attribution = attributions.get(key);
    if (attribution && row.attribution.kind !== 'content')
      return fail('unapproved_attribution', index);
    if (
      row.attribution.kind === 'content' &&
      (!attribution ||
        attribution.contentId !== row.attribution.contentId ||
        attribution.evidenceRef !== row.attribution.evidenceRef)
    )
      return fail('unapproved_attribution', index);
    const earning = row.earning;
    total.amount += BigInt(earning.amountMinor);
    if (earning.kind === 'commission') {
      const group = groups.get(earning.groupRef);
      if (
        !group ||
        group.right !== row.entitlement.right ||
        group.agreementVersion !== row.agreementVersion ||
        group.ratePpm !== earning.ratePpm ||
        !group.channels.includes(earning.channel) ||
        !group.skus.includes(earning.sku)
      )
        return fail('unapproved_rule', index);
      if (!contains(group.calculationWindow, row.earnedAt)) return fail('outside_period', index);
      total.base += BigInt(earning.baseMinor);
      const entries = calculations.get(group.id) ?? [];
      entries.push({ key, index, row });
      calculations.set(group.id, entries);
    } else {
      const amount = amounts.get(key);
      if (
        !amount ||
        amount.agreementVersion !== row.agreementVersion ||
        time(amount.earnedAt) !== time(row.earnedAt) ||
        amount.evidenceRef !== row.evidenceRef ||
        !same(amount.earning, earning)
      )
        return fail('unapproved_amount', index);
      usedAmounts.add(key);
      if (earning.kind === 'adjustment')
        blockers.push({ code: 'original_history_required', row: index });
    }
  }
  if (usedAmounts.size !== amounts.size || usedExclusions.size !== exclusions.size)
    return fail('control_mismatch');
  for (const group of groups.values()) {
    const entries = calculations.get(group.id) ?? [];
    const lines = entries.map(({ key, row }) => ({
      id: key,
      base: BigInt(
        (row.earning as Extract<IncludedRow['earning'], { kind: 'commission' }>).baseMinor,
      ),
    }));
    if (
      lines.length !== group.rows ||
      lines.reduce((s, r) => s + r.base, 0n) !== BigInt(group.baseMinor)
    )
      return fail('control_mismatch');
    const calculated =
      group.rounding.mode === 'per-period'
        ? allocatePeriod(lines, group.ratePpm)
        : Object.fromEntries(lines.map((l) => [l.id, commission(l.base, group.ratePpm)]));
    let sum = 0n;
    for (const entry of entries) {
      const amount = calculated[entry.key];
      sum += amount;
      if (amount !== BigInt(entry.row.earning.amountMinor))
        return fail('calculation_mismatch', entry.index);
    }
    if (sum !== BigInt(group.amountMinor)) return fail('control_mismatch');
  }
  for (const [key, total] of totals) {
    const expected = sources.get(key)!.controls;
    if (
      !same(
        {
          rows: total.rows,
          included: total.included,
          excluded: total.excluded,
          unresolved: total.unresolved,
          eligibleBaseMinor: total.base.toString(),
          amountMinor: total.amount.toString(),
        },
        expected,
      )
    )
      return fail('control_mismatch');
  }
  return {
    ok: true as const,
    kind: 'validated-draft' as const,
    publicationReady: false as const,
    approvalRef: context.approvalRef,
    data: file,
    blockers,
  };
}
