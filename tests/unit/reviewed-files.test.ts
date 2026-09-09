import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm, symlink, truncate } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createReviewedFiles } from '@/server/adapters/reviewed-files/repository';
import { INTAKE_LIMITS } from '@/server/adapters/approved-period/schema';
import { celebrityPeriod } from '../../dev/financial/celebrity-period';
import { celebrityCatalogue } from '../../dev/financial/celebrity-catalogue';
let root: string;
beforeEach(async () => {
  const parent = resolve('.agent-work/runtime/tmp');
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(join(parent, 'reviewed-files-'));
  for (const name of ['exports', 'controls', 'catalogues', 'settlements'])
    await mkdir(join(root, name));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function period() {
  const sample = celebrityPeriod('test-partner');
  await writeFile(join(root, 'exports', 'review-one.json'), sample.raw);
  await writeFile(join(root, 'controls', 'review-one.json'), JSON.stringify(sample.context));
  return sample;
}
describe('operator-provisioned reviewed source files', () => {
  it('reads separate export and controls and preserves exact input bytes', async () => {
    const sample = await period(),
      record = await createReviewedFiles(root).periods.load('review-one');
    expect(record.raw).toBe(sample.raw);
    expect(record.context).toEqual(sample.context);
  });
  it('requires explicit absolute configuration and safe record identifiers', async () => {
    expect(() => createReviewedFiles('relative')).toThrow('invalid_input');
    for (const id of [
      '../review-one',
      'review/one',
      '/etc/passwd',
      'review.json',
      '%2e%2e',
      '',
      'a'.repeat(129),
    ])
      await expect(createReviewedFiles(root).periods.load(id)).rejects.toMatchObject({
        code: 'invalid_input',
      });
  });
  it('does not follow symlink files or symlink category directories', async () => {
    await period();
    await symlink(join(root, 'exports', 'review-one.json'), join(root, 'exports', 'alias.json'));
    await expect(createReviewedFiles(root).periods.load('alias')).rejects.toMatchObject({
      code: 'unavailable',
    });
    await rm(join(root, 'controls'), { recursive: true });
    await symlink(join(root, 'exports'), join(root, 'controls'));
    await expect(createReviewedFiles(root).periods.load('review-one')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it('rejects oversized, nonregular, invalid UTF8, missing and malformed sources', async () => {
    await period();
    const path = join(root, 'exports', 'review-one.json');
    await truncate(path, INTAKE_LIMITS.bytes + 1);
    await expect(createReviewedFiles(root).periods.load('review-one')).rejects.toMatchObject({
      code: 'too_large',
    });
    await rm(path);
    await mkdir(path);
    await expect(createReviewedFiles(root).periods.load('review-one')).rejects.toMatchObject({
      code: 'unavailable',
    });
    await rm(path, { recursive: true });
    await writeFile(path, Buffer.from([0xff]));
    await expect(createReviewedFiles(root).periods.load('review-one')).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await period();
    await writeFile(join(root, 'controls', 'review-one.json'), '{broken');
    await expect(createReviewedFiles(root).periods.load('review-one')).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(createReviewedFiles(root).periods.load('absent')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it('validates catalogue ownership and approved settlement structure without writing data', async () => {
    const catalogue = celebrityCatalogue('test-partner');
    await writeFile(join(root, 'catalogues', 'catalogue-one.json'), JSON.stringify(catalogue));
    const files = createReviewedFiles(root);
    expect(await files.catalogues.load('test-partner', 'catalogue-one')).toEqual(catalogue);
    await expect(files.catalogues.load('other-partner', 'catalogue-one')).rejects.toMatchObject({
      code: 'changed',
    });
    const source = { authority: 'finance', account: 'account-one', reference: 'payment-one' };
    const reversal = {
      kind: 'reversal',
      partnerId: 'test-partner',
      source: { ...source, reference: 'reversal-one' },
      original: source,
      reasonRef: 'bank-returned',
      evidenceRef: 'finance-review',
      occurredAt: '2026-09-01T00:00:00Z',
    };
    await writeFile(join(root, 'settlements', 'reversal-one.json'), JSON.stringify(reversal));
    expect(await files.settlements.load('reversal-one')).toEqual(reversal);
    await writeFile(
      join(root, 'settlements', 'reversal-one.json'),
      JSON.stringify({ ...reversal, amountMinor: '9999' }),
    );
    await expect(files.settlements.load('reversal-one')).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});
