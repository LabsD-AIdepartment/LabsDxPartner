import type {
  AdAssociationValue,
  AdDraftValue,
  AdRegistrationValue,
  ResolvedAdValue,
} from '@/contracts/ad-registration';
import {
  RegistrationError,
  sameDraft,
  validateDraft,
  type AdRegistrationTransport,
} from '@/features/marketing-ads/model';
import { readyScenario } from './scenarios/ready';
import type { Capability } from '@/contracts/platform-capabilities';
import type { ConnectionTransport } from '@/features/marketing-ads/ConnectionsPanel';
export const marketingScope = { actorId: 'synthetic-marketing-user', permissionRevision: '1' };
export const lookupModes = [
  'ready',
  'not-found',
  'denied',
  'unsupported',
  'ambiguous',
  'temporary',
  'read-only',
] as const;
export type LookupMode = (typeof lookupModes)[number];
const delay = (signal: AbortSignal, ms: number) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
/** Synthetic account authority; no platform requests, tokens or money writes. */
export function createAdRegistrationTransport(
  options: { latency?: number; now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  const latency = options.latency ?? 180;
  let mode: LookupMode = 'ready';
  let syncFailure = false;
  let sequence = 0;
  const receipts = new Map<string, ResolvedAdValue>();
  const associations: AdAssociationValue[] = [];
  const targets = readyScenario().content.data.items.map((clip) => ({
    id: `target-${clip.id}`,
    partnerId: 'partner-owner',
    partnerName: 'คุณ (พาร์ทเนอร์ตัวอย่าง)',
    clipId: clip.id,
    clipTitle: clip.title,
    agreementId: 'agreement-owner',
    agreementLabel: 'ข้อตกลง Labs D · ตัวอย่าง',
    cover: clip.cover,
  }));
  targets.push({
    ...targets[0],
    id: 'target-other',
    partnerId: 'partner-other',
    partnerName: 'พาร์ทเนอร์ตัวอย่างอีกคน',
    agreementId: 'agreement-other',
    agreementLabel: 'ข้อตกลงพาร์ทเนอร์อีกคน',
  });
  const previewCapabilities = {
    facebook: 'facebook.ad_insights',
    shopee: 'shopee.ads_reporting',
    lazada: 'lazada.sponsored_reporting',
    tiktok: 'tiktok.business_ads',
  } as const satisfies Record<AdDraftValue['platform'], Capability>;
  const connections: AdRegistrationValue['connections'] = (
    [
      {
        id: 'fb-main',
        platform: 'facebook',
        accountId: 'act-demo-main',
        label: 'Labs D · Facebook หลัก',
        state: 'ready',
      },
      {
        id: 'fb-second',
        platform: 'facebook',
        accountId: 'act-demo-second',
        label: 'Labs D · Facebook แคมเปญ',
        state: 'ready',
      },
      {
        id: 'shopee-main',
        platform: 'shopee',
        accountId: 'shop-demo-shopee',
        label: 'Labs D · Shopee',
        state: 'ready',
      },
      {
        id: 'lazada-main',
        platform: 'lazada',
        accountId: 'shop-demo-lazada',
        label: 'Labs D · Lazada',
        state: 'ready',
      },
      {
        id: 'tiktok-main',
        platform: 'tiktok',
        accountId: 'advertiser-demo-tiktok',
        label: 'Labs D · TikTok',
        state: 'ready',
      },
      {
        id: 'fb-expired',
        platform: 'facebook',
        accountId: 'act-demo-expired',
        label: 'Facebook · ต้องเชื่อมต่อใหม่',
        state: 'reconnect',
      },
    ] as const
  ).map((row) => ({
    ...row,
    availability: {
      capability: previewCapabilities[row.platform],
      phase: 'enabled',
      verifiedAt: new Date(now()).toISOString(),
      reason: null,
    },
  }));
  const check = (scope: typeof marketingScope) => {
    if (
      scope.actorId !== marketingScope.actorId ||
      scope.permissionRevision !== marketingScope.permissionRevision
    )
      throw new RegistrationError('forbidden', 'ไม่มีสิทธิ์เข้าถึงข้อมูลทีม Marketing');
  };
  const snapshot = (): AdRegistrationValue => ({
    schemaVersion: 2,
    sourceMode: 'synthetic',
    ...marketingScope,
    canManage: mode !== 'read-only',
    targets: targets.map((target) => ({ ...target, available: true })),
    connections,
    associations,
  });
  const refreshStates = () => {
    for (const row of associations) {
      if (connections.find((c) => c.id === row.connection.id)?.availability.phase !== 'enabled')
        continue;
      const age = now() - Date.parse(row.createdAt);
      if (row.sync === 'ready') continue;
      row.sync =
        age < 500 ? 'queued' : age < 1600 ? 'syncing' : syncFailure ? 'needs-attention' : 'ready';
      row.issue =
        row.sync === 'needs-attention'
          ? 'สิทธิ์บัญชีหมดอายุ ติดต่อผู้ดูแลเพื่อเชื่อมต่อใหม่'
          : null;
      if (row.sync === 'ready') {
        row.lastSuccessAt = new Date(now()).toISOString();
        // Source cutoff is deliberately separate from fetch time.
        row.dataThrough = '2026-09-01T05:00:00Z';
      }
    }
  };
  const transport: AdRegistrationTransport = {
    async read({ scope, signal }) {
      await delay(signal, latency);
      check(scope);
      refreshStates();
      return structuredClone(snapshot());
    },
    async resolve({ scope, draft: raw, signal }) {
      await delay(signal, latency);
      check(scope);
      const { draft, connection } = validateDraft(snapshot(), raw);
      const errors = {
        'not-found': 'ไม่พบ Ad ID ในบัญชีที่เลือก ตรวจรหัสและบัญชีอีกครั้ง',
        denied: 'บัญชีนี้ไม่มีสิทธิ์อ่านแอดนี้ ติดต่อผู้ดูแลบัญชีโฆษณา',
        unsupported: 'ต้นทางรองรับเฉพาะยอดระดับแคมเปญ จึงยังผูกเป็นยอดของคลิปนี้ไม่ได้',
        ambiguous: 'แอดนี้มีหลายชิ้นงานและยังแยกสถิติไม่ได้ ให้ทีมตรวจการผูกชิ้นงานก่อน',
        temporary: 'แพลตฟอร์มยังไม่พร้อมชั่วคราว ลองค้นหาอีกครั้ง',
      };
      if (mode in errors)
        throw new RegistrationError(
          mode as keyof typeof errors,
          errors[mode as keyof typeof errors],
        );
      const receipt = `synthetic-ad-receipt-${++sequence}`;
      const result: ResolvedAdValue = {
        receipt,
        expiresAt: new Date(now() + 120000).toISOString(),
        draft,
        accountId: connection.accountId,
        objectType: 'ad',
        name: `โฆษณาตัวอย่าง ${draft.externalId}`,
        delivery: 'active',
        creativeId: `creative-${draft.externalId}`,
        cover: targets[0].cover,
      };
      receipts.set(receipt, result);
      // Bound unused receipts in this in-memory preview.
      while (receipts.size > 100) receipts.delete(receipts.keys().next().value!);
      return structuredClone(result);
    },
    async save({ scope, draft: raw, receipt, signal }) {
      await delay(signal, latency);
      check(scope);
      const { draft, target, connection } = validateDraft(snapshot(), raw);
      const resolved = receipts.get(receipt);
      if (
        !resolved ||
        !sameDraft(draft, resolved.draft) ||
        Date.parse(resolved.expiresAt) <= now() ||
        resolved.accountId !== connection.accountId
      )
        throw new RegistrationError(
          'expired',
          'ข้อมูลแอดหมดอายุหรือเปลี่ยนแล้ว กรุณาค้นหาอีกครั้ง',
        );
      const existing = associations.find(
        (row) =>
          row.connection.platform === draft.platform &&
          row.connection.accountId === connection.accountId &&
          row.objectType === resolved.objectType &&
          row.externalId === draft.externalId,
      );
      if (existing) {
        if (
          existing.target.partnerId !== target.partnerId ||
          existing.target.clipId !== target.clipId ||
          existing.target.agreementId !== target.agreementId
        )
          throw new RegistrationError(
            'conflict',
            'แอดนี้ผูกกับคลิปหรือข้อตกลงอื่นแล้ว ให้ผู้ดูแลตรวจสอบก่อนเปลี่ยน',
          );
        return { association: structuredClone(existing), replayed: true };
      }
      if (associations.length >= 500) throw new RegistrationError('invalid', 'ชุดตัวอย่างเต็มแล้ว');
      const row: AdAssociationValue = {
        id: `synthetic-ad-association-${++sequence}`,
        target: structuredClone(target),
        connection: structuredClone(connection),
        externalId: draft.externalId,
        objectType: 'ad',
        name: resolved.name,
        creativeId: resolved.creativeId,
        delivery: resolved.delivery,
        sync: 'queued',
        createdAt: new Date(now()).toISOString(),
        lastSuccessAt: null,
        dataThrough: null,
        issue: null,
      };
      associations.unshift(row);
      return { association: structuredClone(row), replayed: false };
    },
  };
  return {
    transport,
    connectionTransport: (() => {
      const revisions = new Map<string, number>(),
        checks = new Map<string, string>();
      const prior = new Map<
        string,
        { connectionId: string; revision: string; enabled: boolean; replayed: boolean }
      >();
      return {
        async read(scope, signal) {
          await delay(signal, latency);
          check(scope);
          refreshStates();
          return {
            ...scope,
            connections: connections
              .filter((c) => c.platform === 'facebook')
              .map((c) => {
                const jobs = associations.filter((a) => a.connection.id === c.id);
                return {
                  id: c.id,
                  label: c.label,
                  platform: 'facebook',
                  accountId: c.accountId,
                  revision: String(revisions.get(c.id) ?? 1),
                  enabled: c.availability.phase === 'enabled' && c.state === 'ready',
                  configured: true,
                  verifiedAt: checks.get(c.id) ?? null,
                  jobs: jobs.length,
                  attention: jobs.filter((j) => j.sync === 'needs-attention').length,
                  lastSuccessAt: jobs.find((j) => j.lastSuccessAt)?.lastSuccessAt ?? null,
                };
              }),
          };
        },
        async command(cmd, signal) {
          await delay(signal, latency);
          check(cmd);
          if (mode === 'read-only') throw new Error('ไม่มีสิทธิ์เปลี่ยนการเชื่อมต่อ');
          const old = prior.get(cmd.idempotencyKey);
          if (old) return { ...old, replayed: true };
          const c = connections.find((c) => c.id === cmd.connectionId && c.platform === 'facebook');
          if (!c || String(revisions.get(c.id) ?? 1) !== cmd.revision)
            throw new Error('ข้อมูลเปลี่ยน กรุณาตรวจรายการล่าสุด');
          if (cmd.action === 'verify' && mode === 'denied')
            throw new Error('สิทธิ์ของบัญชีต้นทางไม่พร้อม');
          if (cmd.action !== 'retry') {
            c.availability.phase = cmd.action === 'pause' ? 'configured' : 'enabled';
            c.availability.reason = cmd.action === 'pause' ? 'พักการรับข้อมูล' : null;
            revisions.set(c.id, (revisions.get(c.id) ?? 1) + 1);
            if (cmd.action === 'verify') {
              c.state = 'ready';
              checks.set(c.id, new Date(now()).toISOString());
            }
          } else
            for (const row of associations)
              if (row.connection.id === c.id && row.sync === 'needs-attention') {
                row.sync = 'queued';
                row.issue = null;
                row.createdAt = new Date(now()).toISOString();
              }
          const result = {
            connectionId: c.id,
            revision: String(revisions.get(c.id) ?? 1),
            enabled: c.availability.phase === 'enabled' && c.state === 'ready',
            replayed: false,
          };
          prior.set(cmd.idempotencyKey, result);
          return result;
        },
      } satisfies ConnectionTransport;
    })(),
    setRollout: (profile: 'all' | 'facebook-first' | 'off') => {
      for (const row of connections) {
        const enabled =
          profile === 'all' || (profile === 'facebook-first' && row.platform === 'facebook');
        row.availability.phase = enabled ? 'enabled' : 'configured';
        row.availability.reason = enabled ? null : 'กำลังเตรียมการเชื่อมต่อแพลตฟอร์มนี้';
      }
    },
    setMode: (value: LookupMode) => {
      mode = value;
    },
    setSyncFailure: (value: boolean) => {
      syncFailure = value;
    },
    setCapabilityPhase: (
      connectionId: string,
      phase: AdRegistrationValue['connections'][number]['availability']['phase'],
    ) => {
      const connection = connections.find((row) => row.id === connectionId);
      if (!connection) throw new Error('Unknown synthetic connection');
      connection.availability.phase = phase;
      connection.availability.reason =
        phase === 'enabled' ? null : 'ยังไม่เปิดรับการเชื่อมแอดจากบัญชีนี้';
    },
  };
}
