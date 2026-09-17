import { afterEach as restoreBrandFlag } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { StatementDetail } from '@/features/transactions/StatementDetail';
import { StatementList } from '@/features/transactions/StatementList';
import { DocumentList } from '@/features/transactions/DocumentList';
import {
  loadTransactions,
  TransactionError,
  safeTransactionReturn,
  signedDocument,
  type TransactionTransport,
  type PreparedDocument,
  type DocumentTransport,
} from '@/features/transactions/model';
import {
  transactionFixture,
  createTransactionTransport,
  sampleDocumentText,
} from '../../dev/transaction-transport';
import { overviewFixture } from '../../dev/overview-transport';
import { obligationHref, earningsHref } from '@/features/overview/model';
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
const request = {
  resource: 'detail' as const,
  statementId: 'statement-1',
  scope,
  signal: new AbortController().signal,
};
const props = {
  scope,
  transport: createTransactionTransport('ready'),
  documents: vi.fn<DocumentTransport>(),
  basePath: '/transactions-preview',
  returnTo: '/overview-preview',
};
const wrap = (ui: React.ReactNode) => <ScopedQueryProvider scope={scope}>{ui}</ScopedQueryProvider>;
describe('F06 exact statements and independent settlement boundary', () => {
  it.each([
    ['ready', '2552000'],
    ['pending', '3736000'],
    ['paid', '0'],
    ['adjustments', '2452000'],
    ['credit', '-264000'],
  ] as const)('reconciles %s including evidenced payment components', async (mode, closing) => {
    const result = await loadTransactions(async () => transactionFixture(mode), request);
    expect(result.data.statement.closing.minor).toBe(closing);
  });
  it('later payment changes unpaid and settlement revision, not old-period earnings/version', async () => {
    // This regression intentionally exercises the retained opt-in brand return context.
    vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true');
    const filters = { from: '2026-07-01', toExclusive: '2026-09-01', brand: 'Axtion' };
    const before = overviewFixture(filters),
      after = overviewFixture(filters, 'ready', true);
    const detail = await loadTransactions(async () => transactionFixture('ready', true), request);
    expect(before.earnings.confirmed!.minor).toBe('1592000');
    expect(after.earnings.confirmed).toEqual(before.earnings.confirmed);
    expect(detail.data.statement.newEarnings.minor).toBe('3736000');
    expect(detail.data.statement.version).toBe('1');
    expect(detail.data.statement.closing).toEqual(after.obligation.confirmedUnpaid);
    expect(detail.data.statement.closing.minor).toBe('1552000');
    expect(detail.data.settlements.items[1].recordedAt).toBe('2026-09-02T12:00:00+07:00');
    const href = obligationHref(
      after,
      'statement-1',
      '/transactions-preview',
      earningsHref('/overview-preview', after, filters),
    );
    const url = new URL(href, 'http://localhost');
    expect(url.searchParams.has('generation')).toBe(false);
    expect(
      new URL(url.searchParams.get('returnTo')!, 'http://localhost').searchParams.get('brand'),
    ).toBe('Axtion');
  });
  it.each(['id', 'document', 'bridge', 'settlement', 'line', 'status', 'duplicate'] as const)(
    'rejects mismatched %s before exposing totals',
    async (field) => {
      const d = transactionFixture();
      if (field === 'id') d.data.statement.id = 'another';
      if (field === 'document') d.data.documents[0].statementId = 'another';
      if (field === 'bridge') d.data.statement.closing.minor = '999';
      if (field === 'settlement') d.data.settlements.items = [];
      if (field === 'line') d.data.lines.items = [];
      if (field === 'status') d.data.statement.status = 'paid';
      if (field === 'duplicate') d.data.documents.push(d.data.documents[0]);
      await expect(loadTransactions(async () => d, request)).rejects.toThrow();
    },
  );
  it('rejects mixed statement versions and settlement revisions on continuation', async () => {
    await expect(
      loadTransactions(async () => transactionFixture(), { ...request, version: 'older' }),
    ).rejects.toMatchObject({ code: 'changed' });
    await expect(
      loadTransactions(async () => transactionFixture('ready', true), {
        ...request,
        revision: '1',
      }),
    ).rejects.toMatchObject({ code: 'changed' });
  });
  it('drops an aborted response even if the adapter ignores cancellation', async () => {
    const a = new AbortController();
    a.abort();
    await expect(
      loadTransactions(async () => transactionFixture(), { ...request, signal: a.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('filters statements without changing the all-period unpaid amount', async () => {
    const d = await loadTransactions(createTransactionTransport('ready'), {
      resource: 'list',
      status: 'paid',
      scope,
      signal: new AbortController().signal,
    });
    expect(d.data.items.map((x) => x.id)).toEqual(['statement-previous']);
    expect(d.confirmedUnpaid.minor).toBe('2552000');
  });
  it('uses only allowed return routes and HTTPS download tickets', () => {
    expect(safeTransactionReturn('//evil.test', true)).toBe('/overview-preview');
    expect(safeTransactionReturn('javascript:alert(1)', true)).toBe('/overview-preview');
    expect(safeTransactionReturn('/transactions-preview?returnTo=bad', true)).toBe(
      '/overview-preview',
    );
    expect(() =>
      signedDocument({
        downloadUrl: 'javascript:alert(1)',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    ).toThrow();
  });
});
describe('F06 presentation and document lifecycle', () => {
  it('renders frozen amounts and payment breakdown without eagerly preparing files', async () => {
    render(wrap(<StatementDetail {...props} statementId="statement-1" />));
    expect((await screen.findAllByText('฿25,520')).length).toBeGreaterThan(0);
    expect(screen.getByText('ภาษีหัก ณ ที่จ่าย')).toBeVisible();
    expect(props.documents).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'สอบถามเกี่ยวกับรอบจ่ายนี้' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('statement-1');
  });
  it('renders unavailable and forbidden without financial cards', async () => {
    const r = render(
      wrap(
        <StatementDetail
          {...props}
          transport={createTransactionTransport('unavailable')}
          statementId="statement-1"
        />,
      ),
    );
    await screen.findByText('ยังไม่มีข้อมูลจากระบบต้นทาง');
    expect(screen.queryByText('฿25,520')).toBeNull();
    r.unmount();
    render(
      wrap(
        <StatementDetail
          {...props}
          transport={createTransactionTransport('forbidden')}
          statementId="statement-1"
        />,
      ),
    );
    await screen.findByText('คุณไม่มีสิทธิ์ดูรอบจ่ายนี้');
    expect(screen.queryByText('฿25,520')).toBeNull();
  });
  it('shows an empty list honestly', async () => {
    render(wrap(<StatementList {...props} transport={createTransactionTransport('empty')} />));
    expect(await screen.findByText('ยังไม่มีรอบจ่ายในสถานะนี้')).toBeVisible();
  });
  it('prepares only the chosen document then saves on the separate user action', async () => {
    const save = vi.fn(),
      documents = vi
        .fn<DocumentTransport>()
        .mockResolvedValue({ expiresAt: new Date(Date.now() + 60000).toISOString(), save });
    render(<DocumentList {...props} documents={documents} data={transactionFixture().data} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'เตรียมดาวน์โหลด' })[0]);
    await screen.findByText('เอกสารพร้อมดาวน์โหลด');
    expect(documents).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(documents.mock.calls[0][0]).toMatchObject({
      scope,
      statementId: 'statement-1',
      version: '1',
      documentId: 'statement-document',
    });
    fireEvent.click(screen.getByRole('button', { name: 'ดาวน์โหลด' }));
    expect(save).toHaveBeenCalledOnce();
  });
  it.each(['expired', 'forbidden', 'error'])(
    'handles %s download without exposing a link',
    async (mode) => {
      const documents: DocumentTransport = async () => {
        if (mode === 'forbidden') throw new TransactionError('forbidden', 'ไม่มีสิทธิ์');
        if (mode === 'error') throw new Error('ขัดข้อง');
        return { expiresAt: new Date(0).toISOString(), save: vi.fn() };
      };
      render(<DocumentList {...props} documents={documents} data={transactionFixture().data} />);
      fireEvent.click(screen.getAllByRole('button', { name: 'เตรียมดาวน์โหลด' })[0]);
      await screen.findByRole('alert');
      expect(screen.queryByRole('button', { name: 'ดาวน์โหลด' })).toBeNull();
    },
  );
  it('disposes late prepared files when the partner scope changes', async () => {
    let resolve!: (value: PreparedDocument) => void;
    const documents: DocumentTransport = () => new Promise((r) => (resolve = r));
    const dispose = vi.fn(),
      save = vi.fn();
    const r = render(
      <DocumentList {...props} documents={documents} data={transactionFixture().data} />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'เตรียมดาวน์โหลด' })[0]);
    r.rerender(
      <DocumentList
        {...props}
        scope={{ ...scope, partnerId: 'other' }}
        documents={documents}
        data={transactionFixture().data}
      />,
    );
    await act(async () =>
      resolve({ expiresAt: new Date(Date.now() + 60000).toISOString(), dispose, save }),
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByText('เอกสารพร้อมดาวน์โหลด')).toBeNull();
  });
  it('marks the generated example as synthetic and reconciles its exact minor amounts', () => {
    const csv = sampleDocumentText('ready', true, 'statement-1', 'statement-document');
    expect(csv).toContain('SYNTHETIC SAMPLE ONLY');
    expect(csv).toContain('newEarnings_satang,3736000');
    expect(csv).toContain('settled_satang,2184000');
    expect(csv).toContain('closing_satang,1552000');
    const paymentCsv = sampleDocumentText('ready', true, 'statement-1', 'synthetic-evidence-later');
    expect(paymentCsv).toContain('payment_reference,synthetic-transfer-later');
    expect(paymentCsv).toContain('paid_at,2026-09-02T10:00:00+07:00');
    expect(paymentCsv).toContain('cash_satang,1000000');
    expect(paymentCsv).toContain('obligationSettled_satang,1000000');
    expect(() => sampleDocumentText('ready', false, 'statement-1', 'another')).toThrow();
  });
});

restoreBrandFlag(() => vi.unstubAllEnvs());
