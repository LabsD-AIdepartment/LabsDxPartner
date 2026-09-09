import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { transactionHttp, statementDocumentHttp } from '@/features/transactions/http';
import { DocumentList } from '@/features/transactions/DocumentList';
import { TransactionError } from '@/features/transactions/model';
import { transactionFixture } from '../../dev/transaction-transport';

const statementId = '00112233-4455-4677-8899-aabbccddeeff';
const version = '11223344-5566-4788-99aa-bbccddeeff00';
const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: 'p1:m1' };
const request = () => ({
  scope,
  statementId,
  version,
  documentId: 'csv:' + statementId,
  signal: new AbortController().signal,
});
function detail() {
  const value = transactionFixture();
  value.data.statement.id = statementId;
  value.data.statement.version = version;
  value.data.documents = [
    { id: 'csv:' + statementId, statementId, name: 'ใบสรุปรายได้ CSV', kind: 'statement' },
  ];
  return value;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('native statement HTTP and document delivery', () => {
  it('sends bounded scope and page context to same-origin HTTP without accepting an actor argument', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    const r = request();
    await transactionHttp({ ...r, resource: 'detail', revision: '2:3', lineCursor: 'page+1' });
    const [path, options] = fetcher.mock.calls[0];
    const url = new URL(path, 'https://example.test');
    expect(url.pathname).toBe('/api/v1/partner/statements/' + statementId);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      partnerId: scope.partnerId,
      permissionRevision: scope.permissionRevision,
      version,
      revision: '2:3',
      lineCursor: 'page+1',
    });
    expect(options).toEqual({ credentials: 'same-origin', cache: 'no-store', signal: r.signal });
    await expect(
      transactionHttp({ ...r, resource: 'detail', statementId: '//foreign.test' }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, 'forbidden'],
    [403, 'forbidden'],
    [409, 'changed'],
    [503, 'unavailable'],
  ] as const)('maps HTTP %i to %s without exposing server internals', async (status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ secret: 'internal' }, { status })),
    );
    await expect(transactionHttp({ ...request(), resource: 'list' })).rejects.toMatchObject({
      code,
    });
  });
  it('checks membership again on save and denies a revoked document without creating a download', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(detail()))
      .mockResolvedValueOnce(Response.json({}, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const file = await statementDocumentHttp(request());
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(file.save()).rejects.toMatchObject({ code: 'forbidden' });
    expect(fetcher.mock.calls[1][0]).toBe(
      '/api/v1/partner/statements/' +
        statementId +
        '/export?' +
        new URLSearchParams({ partnerId: scope.partnerId, version }),
    );
    expect(click).not.toHaveBeenCalled();
  });
  it('downloads only returned CSV; disposed or foreign document requests do not fetch', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(detail()))
      .mockResolvedValueOnce(
        new Response('amount\r\n37360.00', {
          headers: { 'content-type': 'text/csv; charset=utf-8' },
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const create = vi.fn().mockReturnValue('blob:synthetic-statement');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    let saved: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved = this;
    });
    const file = await statementDocumentHttp(request());
    await file.save();
    expect(saved?.download).toBe('statement-' + statementId + '.csv');
    expect(saved?.target).toBe('');
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:synthetic-statement'));
    file.dispose?.();
    await expect(file.save()).rejects.toThrow();
    await expect(
      statementDocumentHttp({ ...request(), documentId: 'another' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('shows an asynchronous download denial inline instead of an unhandled rejection or silent button', async () => {
    render(
      <DocumentList
        data={detail().data}
        scope={scope}
        basePath="/transactions"
        returnTo="/overview"
        transport={transactionHttp}
        documents={async () => ({
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          save: async () => {
            throw new TransactionError('forbidden', 'สิทธิ์ดาวน์โหลดถูกยกเลิกแล้ว');
          },
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'เตรียมดาวน์โหลด' }));
    fireEvent.click(await screen.findByRole('button', { name: /^ดาวน์โหลด$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('สิทธิ์ดาวน์โหลดถูกยกเลิกแล้ว');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
