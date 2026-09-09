import { z } from 'zod';
import { Id, Instant } from '@/contracts/common';
import {
  StatementDetailResponse,
  StatementListResponse,
  DownloadResponse,
} from '@/contracts/statements';
import type { QueryScope } from '@/shared/query/keys';
export type StatementStatus = 'all' | 'pending' | 'part-paid' | 'paid' | 'credit';
export type TransactionRequest = {
  scope: QueryScope;
  resource: 'list' | 'detail';
  statementId?: string;
  status?: StatementStatus;
  cursor?: string | null;
  lineCursor?: string | null;
  settlementCursor?: string | null;
  version?: string;
  revision?: string;
  signal: AbortSignal;
};
export type TransactionTransport = (request: TransactionRequest) => Promise<unknown>;
export type ListValue = z.infer<typeof StatementListResponse>;
export type DetailValue = z.infer<typeof StatementDetailResponse>;
export class TransactionError extends Error {
  constructor(
    public code: 'forbidden' | 'not_found' | 'changed' | 'invalid_response' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}
const invalid = () => {
  throw new TransactionError('invalid_response', 'ข้อมูลรอบจ่ายไม่ตรงกัน กรุณาโหลดใหม่');
};
function unique(rows: { id: string }[]) {
  if (new Set(rows.map((x) => x.id)).size !== rows.length) invalid();
}
export async function loadTransactions(
  transport: TransactionTransport,
  r: TransactionRequest & { resource: 'list' },
): Promise<ListValue>;
export async function loadTransactions(
  transport: TransactionTransport,
  r: TransactionRequest & { resource: 'detail' },
): Promise<DetailValue>;
export async function loadTransactions(
  transport: TransactionTransport,
  r: TransactionRequest,
): Promise<ListValue | DetailValue> {
  if (r.statementId !== undefined && !Id.safeParse(r.statementId).success) invalid();
  const raw = await transport(r);
  if (r.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const result = (
    r.resource === 'list' ? StatementListResponse : StatementDetailResponse
  ).safeParse(raw);
  if (!result.success) invalid();
  const value = result.data!;
  const statements = 'items' in value.data ? value.data.items : [value.data.statement];
  for (const s of statements) {
    const remaining = BigInt(s.closing.minor),
      settled = BigInt(s.settled.minor);
    if (
      (s.status === 'paid' && remaining !== 0n) ||
      (s.status === 'credit' && remaining >= 0n) ||
      (s.status === 'pending' && (remaining <= 0n || settled !== 0n)) ||
      (s.status === 'part-paid' && (remaining <= 0n || settled <= 0n))
    )
      invalid();
  }
  if ('items' in value.data && r.cursor && value.data.nextCursor === r.cursor) invalid();
  if (
    !('items' in value.data) &&
    ((r.lineCursor && value.data.lines.nextCursor === r.lineCursor) ||
      (r.settlementCursor && value.data.settlements.nextCursor === r.settlementCursor))
  )
    invalid();
  if (r.revision && value.settlementsRevision !== r.revision)
    throw new TransactionError('changed', 'สถานะการจ่ายเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด');
  if ('items' in value.data) {
    unique(value.data.items);
    if (r.status && r.status !== 'all' && value.data.items.some((x) => x.status !== r.status))
      invalid();
  } else {
    const { statement: s, documents, lines, settlements } = value.data;
    if (s.id !== r.statementId || documents.some((d) => d.statementId !== s.id)) invalid();
    if (r.version && s.version !== r.version)
      throw new TransactionError('changed', 'ใบสรุปรอบจ่ายมีเวอร์ชันใหม่ กรุณาโหลดข้อมูลล่าสุด');
    unique(documents);
    unique(lines.items);
    unique(settlements.items);
    if (lines.items.some((x) => x.status === 'estimated')) invalid();
    // Validate complete pages only; never infer totals from partial pages.
    if (
      !r.settlementCursor &&
      !settlements.nextCursor &&
      settlements.items.reduce((n, x) => n + BigInt(x.obligationSettled.minor), 0n) !==
        BigInt(s.settled.minor)
    )
      invalid();
    if (!r.lineCursor && !lines.nextCursor) {
      const sum = (adjustment: boolean) =>
        lines.items
          .filter((x) => (x.kind === 'adjustment') === adjustment)
          .reduce((n, x) => n + BigInt(x.amount.minor), 0n);
      if (sum(false) !== BigInt(s.newEarnings.minor) || sum(true) !== BigInt(s.adjustments.minor))
        invalid();
    }
  }
  return value as ListValue | DetailValue;
}
export type DocumentRequest = {
  scope: QueryScope;
  statementId: string;
  version: string;
  documentId: string;
  signal: AbortSignal;
};
/** Adapter owns file delivery; UI does not create financial documents or authorize access. */
export type PreparedDocument = {
  expiresAt: string;
  save: () => void | Promise<void>;
  dispose?: () => void;
};
export type DocumentTransport = (request: DocumentRequest) => Promise<PreparedDocument>;
/** Future HTTP adapter validates signed HTTPS tickets before exposing a download action. */
export function signedDocument(raw: unknown): PreparedDocument {
  const ticket = DownloadResponse.parse(raw);
  return {
    expiresAt: ticket.expiresAt,
    save: () => {
      if (Date.parse(ticket.expiresAt) <= Date.now()) throw new Error('ลิงก์ดาวน์โหลดหมดอายุ');
      const a = document.createElement('a');
      a.href = ticket.downloadUrl;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      a.click();
    },
  };
}
export function documentIsCurrent(d: PreparedDocument) {
  return Instant.safeParse(d.expiresAt).success && Date.parse(d.expiresAt) > Date.now();
}
export function transactionHref(base: string, statementId?: string, returnTo?: string) {
  const path = base + (statementId ? '/' + encodeURIComponent(statementId) : '');
  return returnTo ? path + '?' + new URLSearchParams({ returnTo }) : path;
}
export function safeTransactionReturn(value: string | null, preview = false) {
  if (!value || value.startsWith('//') || /[\\\r\n]/.test(value))
    return preview ? '/overview-preview' : '/overview';
  const [path] = value.split('?');
  return (preview ? ['/overview-preview', '/content-preview'] : ['/overview', '/content']).includes(
    path,
  )
    ? value
    : preview
      ? '/overview-preview'
      : '/overview';
}
