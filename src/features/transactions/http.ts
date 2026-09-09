import { z } from 'zod';
import {
  loadTransactions,
  TransactionError,
  type TransactionTransport,
  type DocumentTransport,
} from './model';

function check(response: Response) {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403)
    throw new TransactionError('forbidden', 'คุณไม่มีสิทธิ์ดูเอกสารหรือรอบจ่ายนี้แล้ว');
  if (response.status === 409)
    throw new TransactionError('changed', 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดรอบจ่ายใหม่');
  if (response.status === 413)
    throw new TransactionError('unavailable', 'รายการเกินขนาดที่ดาวน์โหลดได้ กรุณาติดต่อผู้ดูแล');
  throw new TransactionError('unavailable', 'ยังโหลดข้อมูลรอบจ่ายไม่ได้ กรุณาลองอีกครั้ง');
}
const statementPath = (id: string) => '/api/v1/partner/statements/' + z.uuid().parse(id);

export const transactionHttp: TransactionTransport = async (r) => {
  const query = new URLSearchParams({
    partnerId: r.scope.partnerId,
    permissionRevision: r.scope.permissionRevision,
  });
  for (const key of [
    'status',
    'cursor',
    'lineCursor',
    'settlementCursor',
    'version',
    'revision',
  ] as const)
    if (r[key] != null) query.set(key, r[key]);
  const path =
    r.resource === 'list' ? '/api/v1/partner/statements' : statementPath(r.statementId ?? '');
  const response = await fetch(path + '?' + query, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: r.signal,
  });
  check(response);
  return response.json();
};

export const statementDocumentHttp: DocumentTransport = async (r) => {
  if (r.documentId !== 'csv:' + r.statementId)
    throw new TransactionError('forbidden', 'ไม่พบเอกสารนี้ในรอบจ่าย');
  const detail = await loadTransactions(transactionHttp, {
    scope: r.scope,
    resource: 'detail',
    statementId: r.statementId,
    version: r.version,
    signal: r.signal,
  });
  if (!detail.data.documents.some((d) => d.id === r.documentId))
    throw new TransactionError('forbidden', 'ไม่พบเอกสารนี้ในรอบจ่าย');
  const query = new URLSearchParams({ partnerId: r.scope.partnerId, version: r.version });
  const path = statementPath(r.statementId) + '/export?' + query;
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  let disposed = false;
  // Fetch on the actual download click: re-check current native membership and version.
  // No authorization-bearing ticket, cross-origin link, or reusable cached finance blob.
  return {
    expiresAt,
    dispose: () => {
      disposed = true;
    },
    save: async () => {
      if (disposed || r.signal.aborted || Date.now() >= Date.parse(expiresAt))
        throw new Error('กรุณาเตรียมเอกสารใหม่');
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: r.signal,
      });
      check(response);
      if (!response.headers.get('content-type')?.startsWith('text/csv'))
        throw new Error('รูปแบบเอกสารไม่ถูกต้อง');
      const blob = await response.blob();
      if (disposed || r.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'statement-' + r.statementId + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  };
};
