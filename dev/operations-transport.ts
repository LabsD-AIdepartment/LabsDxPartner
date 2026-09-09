import { OpsSnapshot } from '@/contracts/operations';
import {
  commandTarget,
  OpsError,
  validateCommand,
  type OpsTransport,
} from '@/features/operations/model';
import { readyScenario, at, money, period } from './scenarios/ready';
import { previewWait } from './async-preview';
export const opsScope = { actorId: 'preview-staff', permissionRevision: '1' };
export const opsModes = [
  'ready',
  'read-only',
  'multiple-members',
  'empty',
  'partial',
  'stale',
  'unavailable',
  'loading',
  'error',
  'forbidden',
  'reauth',
  'changed',
  'pending',
] as const;
export type OpsMode = (typeof opsModes)[number];
export function opsFixture(mode: OpsMode = 'ready') {
  const sample = readyScenario();
  return OpsSnapshot.parse({
    actorId: opsScope.actorId,
    permissionRevision: '1',
    revision: '1',
    dataState: ['partial', 'stale', 'unavailable'].includes(mode) ? mode : 'ready',
    reasons: mode === 'partial' ? ['หลักฐานบางส่วนยังต้องตรวจสอบ'] : [],
    generatedAt: at,
    dataThrough: at,
    requestId: 'synthetic-ops-request',
    capabilities:
      mode === 'read-only'
        ? []
        : ['manage_partners', 'review_imports', 'publish_statements', 'record_payments'],
    partners: {
      items:
        mode === 'empty'
          ? []
          : [
              {
                id: 'partner-1',
                name: 'มดดำ คชาภา',
                members: [
                  {
                    id: 'membership-1',
                    userId: 'preview-user',
                    displayName: 'มดดำ คชาภา',
                    status: 'active',
                    revision: '1',
                    verifiedContactRef: 'synthetic-known-contact',
                    capabilities: ['view_earnings', 'view_content', 'view_statements'],
                  },
                  ...(mode === 'multiple-members'
                    ? [
                        {
                          id: 'membership-2',
                          userId: 'preview-manager',
                          displayName: 'ผู้จัดการตัวอย่าง',
                          status: 'active',
                          revision: '2',
                          verifiedContactRef: 'synthetic-manager-contact',
                          capabilities: ['view_content'],
                        },
                      ]
                    : []),
                ],
                agreementVersion: sample.account.agreement!.id,
                contentRefs: ['clip-1', 'clip-2', 'clip-3', 'clip-4', 'clip-5', 'clip-6'],
                skuRefs: ['synthetic-sku-1'],
              },
            ],
      nextCursor: null,
      totalCount: mode === 'empty' ? 0 : 1,
    },
    agreements: mode === 'empty' ? [] : [sample.account.agreement],
    imports: {
      items:
        mode === 'empty'
          ? []
          : [
              {
                id: 'import-1',
                source: 'synthetic-approved-period',
                status: 'needs-review',
                startedAt: at,
                publishedAt: null,
                acceptedCount: 6,
                excludedCount: 1,
                reasons: ['รายการ synthetic-unmapped ยังขาดหลักฐานผูกพาร์ทเนอร์'],
              },
              {
                id: 'import-2',
                source: 'synthetic-approved-period',
                status: 'reconciled',
                startedAt: at,
                publishedAt: at,
                acceptedCount: 6,
                excludedCount: 0,
                reasons: [],
              },
            ],
      nextCursor: null,
      totalCount: mode === 'empty' ? 0 : 2,
    },
    periods: {
      items:
        mode === 'empty'
          ? []
          : [
              {
                id: 'period-published',
                partnerId: 'partner-1',
                partnerName: 'มดดำ คชาภา',
                period,
                generation: '1',
                status: 'published',
                confirmed: money('3736000'),
                excludedCount: 0,
                unresolvedCount: 0,
                evidenceRef: 'synthetic-period-evidence',
                statement: sample.statement.statement,
              },
              {
                id: 'period-draft',
                partnerId: 'partner-1',
                partnerName: 'มดดำ คชาภา',
                period: {
                  ...period,
                  from: '2026-09-01T00:00:00+07:00',
                  toExclusive: '2026-10-01T00:00:00+07:00',
                },
                generation: '2',
                status: 'reconciled',
                confirmed: money('1000000'),
                excludedCount: 0,
                unresolvedCount: 0,
                evidenceRef: 'synthetic-draft-evidence',
                statement: null,
              },
            ],
      nextCursor: null,
      totalCount: mode === 'empty' ? 0 : 2,
    },
  });
}
export function createOpsTransport(mode: OpsMode): OpsTransport {
  const value = opsFixture(mode),
    results = new Map<string, { fingerprint: string; result: unknown }>();
  const check = (actorId: string, revision: string) => {
    if (
      actorId !== opsScope.actorId ||
      revision !== opsScope.permissionRevision ||
      mode === 'forbidden'
    )
      throw new OpsError('forbidden', 'ไม่มีสิทธิ์เข้าพื้นที่เจ้าหน้าที่');
  };
  return {
    read: async (r) => {
      await previewWait(r.signal, mode === 'loading' ? null : 30);
      check(r.scope.actorId, r.scope.permissionRevision);
      if (mode === 'error') throw new Error('ข้อมูลต้นทางขัดข้อง');
      return structuredClone(value);
    },
    act: async (r) => {
      await previewWait(r.signal, mode === 'pending' ? null : 150);
      check(r.scope.actorId, r.scope.permissionRevision);
      if (mode === 'reauth') throw new OpsError('reauth', 'ต้องยืนยันตัวตนเจ้าหน้าที่อีกครั้ง');
      if (mode === 'error') throw new Error('ทำรายการไม่สำเร็จ');
      const fingerprint = JSON.stringify(r.command);
      const previous = results.get(r.command.idempotencyKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new OpsError('invalid', 'รหัสรายการถูกใช้กับคำสั่งอื่นแล้ว');
        return structuredClone(previous.result);
      }
      if (mode === 'changed' || r.expectedRevision !== value.revision)
        throw new OpsError('changed', 'ข้อมูลถูกแก้ไขแล้ว กรุณาปิดหน้าต่างและรีเฟรชเพื่อตรวจใหม่');
      validateCommand(r.command, value);
      const c = r.command;
      if (c.action === 'membership') {
        const p = value.partners.items.find((p) => p.id === c.partnerId)!;
        const member = p.members.find((m) => m.userId === c.userId)!;
        member.status = c.status;
        member.verifiedContactRef = c.verifiedContactRef;
        member.capabilities = c.capabilities;
        member.revision = (BigInt(member.revision) + 1n).toString();
      }
      if (c.action === 'terms') {
        const p = value.partners.items.find((p) => p.id === c.partnerId)!;
        p.agreementVersion = c.agreementVersion;
        p.contentRefs = c.contentRefs;
        p.skuRefs = c.skuRefs;
      }
      if (c.action === 'publish') {
        const p = value.periods.items.find((p) => p.id === c.periodId)!;
        p.status = 'published';
        p.statement = {
          ...readyScenario().statement.statement,
          id: 'synthetic-new-statement',
          period: p.period,
          version: '1',
          publishedAt: new Date().toISOString(),
          scheduledAt: null,
          status: 'pending',
          opening: money('0'),
          newEarnings: p.confirmed,
          adjustments: money('0'),
          settled: money('0'),
          closing: p.confirmed,
        };
      }
      if (c.action === 'payment') {
        const p = value.periods.items.find((p) => p.statement?.id === c.statementId)!;
        const amount = BigInt(c.cash.minor) + BigInt(c.withholding.minor) + BigInt(c.other.minor);
        p.statement!.settled = money((BigInt(p.statement!.settled.minor) + amount).toString());
        p.statement!.closing = money((BigInt(p.statement!.closing.minor) - amount).toString());
        p.statement!.status = BigInt(p.statement!.closing.minor) === 0n ? 'paid' : 'part-paid';
        p.statement!.settlementAsOf = new Date().toISOString();
      }
      if (c.action === 'import')
        value.imports.items.unshift({
          id: 'synthetic-import-' + r.command.idempotencyKey,
          source: c.source,
          status: 'running',
          startedAt: new Date().toISOString(),
          publishedAt: null,
          acceptedCount: 0,
          excludedCount: 0,
          reasons: ['ตัวอย่างงานที่รอประมวลผล ยังไม่อ่านไฟล์หรือเรียกต้นทางจริง'],
        });
      value.imports.totalCount = value.imports.items.length;
      value.revision = (BigInt(value.revision) + 1n).toString();
      const result = {
        id: 'synthetic-operation-' + r.command.idempotencyKey,
        requestId: 'synthetic-ops-action',
        actorId: r.scope.actorId,
        targetId: commandTarget(c),
        status: c.action === 'import' ? 'pending' : 'complete',
        message:
          c.action === 'import'
            ? 'รับงานนำเข้าจำลองแล้ว รอประมวลผล'
            : 'บันทึกรายการจำลองแล้ว ไม่มีการแก้ข้อมูลจริง',
      };
      results.set(r.command.idempotencyKey, { fingerprint, result });
      return result;
    },
  };
}
