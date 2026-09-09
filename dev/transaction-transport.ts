import { readyScenario, money } from './scenarios/ready';
import {
  TransactionError,
  type TransactionTransport,
  type DocumentTransport,
  type DetailValue,
} from '@/features/transactions/model';
export type TransactionMode =
  | 'ready'
  | 'empty'
  | 'pending'
  | 'paid'
  | 'credit'
  | 'adjustments'
  | 'partial'
  | 'stale'
  | 'unavailable'
  | 'loading'
  | 'error'
  | 'forbidden'
  | 'not-found';
export type DocumentMode = 'ready' | 'pending' | 'error' | 'forbidden' | 'expired';
export function transactionFixture(
  mode: TransactionMode = 'ready',
  laterPayment = false,
  id = 'statement-1',
): DetailValue {
  const s = readyScenario();
  const data = structuredClone(s.statement);
  if (!['statement-1', 'statement-previous'].includes(id))
    throw new TransactionError('not_found', 'ไม่พบรอบจ่ายนี้');
  data.statement.scheduledAt = '2026-09-15T12:00:00+07:00';
  data.settlements.items[0].paidAt = '2026-09-01T10:00:00+07:00';
  if (mode === 'pending') {
    data.settlements.items = [];
    data.statement.settled = money('0');
    data.statement.closing = money('3736000');
    data.statement.status = 'pending';
  }
  if (mode === 'adjustments' || mode === 'credit') {
    const delta = mode === 'credit' ? '-4000000' : '-100000';
    if (mode === 'credit') {
      data.settlements.items = [];
      data.statement.settled = money('0');
      data.statement.status = 'credit';
    }
    data.lines.items.push({
      ...data.lines.items[0],
      id: 'synthetic-statement-adjustment',
      kind: 'adjustment',
      status: 'adjustment',
      amount: money(delta),
      eligibleBase: null,
      ratePpm: null,
      originalLineId: data.lines.items[0].id,
      reason: 'ปรับคืนจากรายการต้นทางที่ยืนยันแล้ว',
      sourceRef: 'synthetic-refund-reference',
    });
    data.statement.adjustments = money(delta);
    data.statement.closing = money(
      (3736000n + BigInt(delta) - BigInt(data.statement.settled.minor)).toString(),
    );
  }
  if (laterPayment || mode === 'paid') {
    const amount = mode === 'paid' ? BigInt(data.statement.closing.minor) : 1000000n;
    if (amount > 0n && BigInt(data.statement.closing.minor) >= amount) {
      const withheld = mode === 'paid' ? 50000n : 0n;
      data.settlements.items.push({
        id: 'payment-2',
        reference: 'synthetic-transfer-later',
        paidAt: '2026-09-02T10:00:00+07:00',
        recordedAt: '2026-09-02T12:00:00+07:00',
        cash: money((amount - withheld).toString()),
        withholding: money(withheld.toString()),
        other: money('0'),
        obligationSettled: money(amount.toString()),
        evidenceRef: 'synthetic-evidence-later',
      });
      data.statement.settled = money((BigInt(data.statement.settled.minor) + amount).toString());
      data.statement.closing = money((BigInt(data.statement.closing.minor) - amount).toString());
      data.statement.status = mode === 'paid' ? 'paid' : 'part-paid';
      data.statement.settlementAsOf = '2026-09-02T12:00:00+07:00';
    }
  }
  if (id === 'statement-previous') {
    const period = {
      from: '2026-06-01T00:00:00+07:00',
      toExclusive: '2026-07-01T00:00:00+07:00',
      timezone: 'Asia/Bangkok' as const,
    };
    data.statement = {
      ...data.statement,
      id,
      period,
      version: '1',
      publishedAt: '2026-07-01T12:00:00+07:00',
      scheduledAt: '2026-07-15T12:00:00+07:00',
      status: 'paid',
      opening: money('0'),
      newEarnings: money('980000'),
      adjustments: money('0'),
      settled: money('980000'),
      closing: money('0'),
    };
    data.lines.items = [
      {
        ...s.statement.lines.items[0],
        id: 'synthetic-previous-line',
        earnedAt: '2026-06-20T12:00:00+07:00',
        amount: money('980000'),
        kind: 'fixed-fee',
        contentId: null,
        attribution: 'partner-only',
        eligibleBase: null,
        ratePpm: null,
      },
    ];
    data.settlements.items = [
      {
        ...s.statement.settlements.items[0],
        id: 'previous-payment',
        recordedAt: '2026-07-15T12:00:00+07:00',
        paidAt: '2026-07-15T10:00:00+07:00',
        cash: money('950600'),
        withholding: money('29400'),
        obligationSettled: money('980000'),
      },
    ];
  }
  data.lines.totalCount = data.lines.items.length;
  data.settlements.totalCount = data.settlements.items.length;
  data.documents = [
    {
      id: 'statement-document',
      statementId: id,
      name: 'ใบสรุปรอบจ่าย · ตัวอย่าง CSV',
      kind: 'statement',
    },
    ...data.settlements.items.map((p) => ({
      id: p.evidenceRef,
      statementId: id,
      name: 'หลักฐานการชำระ ' + p.reference + ' · ตัวอย่าง CSV',
      kind: 'payment-evidence' as const,
    })),
  ];
  return {
    data,
    dataState: ['partial', 'stale', 'unavailable'].includes(mode)
      ? (mode as 'partial' | 'stale' | 'unavailable')
      : 'ready',
    reasons:
      mode === 'partial'
        ? ['เอกสารบางส่วนยังรอตรวจสอบ']
        : mode === 'stale'
          ? ['กำลังรอการอัปเดตรอบใหม่']
          : mode === 'unavailable'
            ? ['ยังไม่มีข้อมูลจากระบบต้นทาง']
            : [],
    generatedAt: data.statement.settlementAsOf,
    dataThrough: data.statement.settlementAsOf,
    requestId: 'synthetic-transactions-request',
    settlementsRevision: laterPayment || mode === 'paid' ? '2' : '1',
  };
}
function wait(signal: AbortSignal, ms?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (ms !== undefined)
      timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
  });
}
export function createTransactionTransport(
  mode: TransactionMode,
  paid = false,
): TransactionTransport {
  return async (r) => {
    await wait(r.signal, mode === 'loading' ? undefined : 40);
    if (mode === 'forbidden') throw new TransactionError('forbidden', 'คุณไม่มีสิทธิ์ดูรอบจ่ายนี้');
    if (mode === 'not-found') throw new TransactionError('not_found', 'ไม่พบรอบจ่ายนี้');
    if (mode === 'error') throw new Error('การเชื่อมต่อขัดข้อง');
    if (r.resource === 'detail') return transactionFixture(mode, paid, r.statementId);
    const current = transactionFixture(mode, paid),
      previous = transactionFixture('ready', false, 'statement-previous');
    const items =
      mode === 'empty'
        ? []
        : [current.data.statement, previous.data.statement].filter(
            (s) => !r.status || r.status === 'all' || s.status === r.status,
          );
    return {
      ...current,
      asOf: current.data.statement.settlementAsOf,
      confirmedUnpaid: money(
        mode === 'empty'
          ? '0'
          : BigInt(current.data.statement.closing.minor) > 0n
            ? current.data.statement.closing.minor
            : '0',
      ),
      data: { items, nextCursor: null, totalCount: items.length },
    };
  };
}
export function sampleDocumentText(
  mode: TransactionMode,
  paid: boolean,
  statementId: string,
  documentId: string,
) {
  const d = transactionFixture(mode, paid, statementId).data;
  if (!d.documents.some((doc) => doc.id === documentId))
    throw new TransactionError('forbidden', 'ไม่มีสิทธิ์ดาวน์โหลดเอกสารนี้');
  const payment = d.settlements.items.find((p) => p.evidenceRef === documentId);
  return (
    '\uFEFF' +
    [
      'SYNTHETIC SAMPLE ONLY - ไม่ใช่เอกสารการเงินหรือภาษีจริง',
      `statement,${d.statement.id}`,
      `version,${d.statement.version}`,
      `document,${documentId}`,
      `currency,THB`,
      ...(['opening', 'newEarnings', 'adjustments', 'settled', 'closing'] as const).map(
        (k) => `${k}_satang,${d.statement[k].minor}`,
      ),
      ...(payment
        ? [
            `payment_reference,${payment.reference}`,
            `paid_at,${payment.paidAt ?? ''}`,
            `recorded_at,${payment.recordedAt}`,
            ...(['cash', 'withholding', 'other', 'obligationSettled'] as const).map(
              (k) => `${k}_satang,${payment[k].minor}`,
            ),
          ]
        : []),
    ].join('\n')
  );
}
export function createSampleDocuments(
  mode: TransactionMode,
  paid: boolean,
  behavior: DocumentMode,
): DocumentTransport {
  return async (r) => {
    await wait(r.signal, behavior === 'pending' ? undefined : 200);
    if (behavior === 'error') throw new Error('เตรียมเอกสารไม่สำเร็จ ลองอีกครั้ง');
    if (behavior === 'forbidden')
      throw new TransactionError('forbidden', 'คุณไม่มีสิทธิ์ดาวน์โหลดเอกสารนี้');
    const d = transactionFixture(mode, paid, r.statementId).data;
    if (r.version !== d.statement.version) throw new Error('เวอร์ชันเอกสารเปลี่ยนแล้ว');
    const text = sampleDocumentText(mode, paid, r.statementId, r.documentId);
    let url: string | null = null;
    return {
      expiresAt: new Date(Date.now() + (behavior === 'expired' ? -1000 : 60000)).toISOString(),
      dispose: () => {
        if (url) URL.revokeObjectURL(url);
      },
      save: () => {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `SAMPLE-${r.statementId}-${r.documentId}.csv`;
        a.click();
      },
    };
  };
}
