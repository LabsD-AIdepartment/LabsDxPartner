import type {
  WithdrawalProofDocumentValue,
  WithdrawalRequestDetailValue,
  WithdrawalRequestValue,
} from '@/contracts/withdrawal-journey';
import { wrapText } from '@/features/overview/report-export';
import { formatThbMinor } from './model';

// A NEW, focused withdrawal-proof renderer. It produces a COMPACT PDF for a settled withdrawal —
// reusing the existing licensed Thai Sarabun fonts + pdf-lib/fontkit and the shared `wrapText` helper
// — WITHOUT copying the hundred-line overview report renderer. It renders an immutable snapshot of the
// paid request (reference, masked beneficiary, gross, deductions, net and the paid instant) plus an
// explicit 'ข้อมูลตัวอย่าง' + system-issued disclosure. It makes NO tax-invoice / signature /
// bank-logo / bank-slip claim, and never fabricates a provider reference.
//
// HONESTY BOUNDARY — provider bank slips are NOT generated. No original provider bytes and no
// authenticated download endpoint exist yet, so only the system-issued acknowledgment
// (`system_acknowledgment`, issuer `labsd`) may be rendered. A `provider_bank_slip` descriptor —
// even one that carries a reference — is REJECTED with an honest "unsupported" error rather than
// fabricating a document that impersonates the payment provider. The contract still models the
// `provider_bank_slip` arm as a documented FUTURE boundary (real bytes, source-referenced,
// verified-only); this renderer simply refuses to invent one.

export interface WithdrawalProofInput {
  document: WithdrawalProofDocumentValue;
  request: WithdrawalRequestValue;
  // The partner/actor display name, if the caller has one. Falls back to the masked beneficiary name.
  displayName?: string;
}

// Thrown when a caller asks for a document this renderer is not authorised to produce (currently any
// `provider_bank_slip`: no genuine provider bytes/endpoint exist yet, so one is never fabricated).
export class WithdrawalProofUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalProofUnsupportedError';
  }
}

// Reject any document kind this renderer must not synthesise. Only the system-issued acknowledgment
// is generatable; a provider bank slip requires real provider evidence that does not exist yet.
function assertGeneratable(document: WithdrawalProofDocumentValue): void {
  if (document.kind !== 'system_acknowledgment')
    throw new WithdrawalProofUnsupportedError(
      'A provider bank slip cannot be generated: no original provider document or authenticated ' +
        'download exists yet. Only the system-issued acknowledgment (LabsD) is available.',
    );
}

// A cancellation error compatible with the Web `AbortSignal` convention (name === 'AbortError').
function abortError(): Error {
  if (typeof DOMException === 'function')
    return new DOMException('The withdrawal proof download was aborted', 'AbortError');
  const err = new Error('The withdrawal proof download was aborted');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

const THAI_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

// A Bangkok Buddhist-era date-time label for a recorded Instant (e.g. "1 ก.ย. 2569 00:00").
function bangkokThaiDateTime(instant: string): string {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) return instant;
  const d = new Date(ms + BKK_OFFSET_MS);
  const day = d.getUTCDate();
  const month = THAI_MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear() + 543;
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${day} ${month} ${year} ${hh}:${mm}`;
}

const thb = (minor: string): string => `฿${formatThbMinor(minor)}`;

// Build the compact proof PDF bytes. Exposed so a test can assert selectable Thai text + the correct
// net without triggering a browser download. Long identifiers / beneficiary + bank names / a full set
// of deduction lines never overlap a label or run off the page: a value that does not fit beside its
// label wraps onto its own indented line(s), and the whole document paginates (bounded, because every
// contract field is length-bounded and deductions are capped at 10) rather than drawing past the
// bottom margin.
export async function buildWithdrawalProofPdf(input: WithdrawalProofInput): Promise<Uint8Array> {
  const { document, request } = input;
  // Never fabricate a provider bank slip — refuse before any rendering work begins.
  assertGeneratable(document);
  const [{ PDFDocument, rgb }, fontkitModule, fonts] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit'),
    import('@/features/overview/assets/report-fonts'),
  ]);
  const fontkit = (fontkitModule as { default: unknown }).default ?? fontkitModule;
  const toBytes = (b64: string): Uint8Array => {
    if (typeof atob === 'function') {
      const binary = atob(b64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  };

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as Parameters<typeof doc.registerFontkit>[0]);
  const body = await doc.embedFont(toBytes(fonts.sarabunRegularBase64), { subset: true });
  const bold = await doc.embedFont(toBytes(fonts.sarabunSemiBoldBase64), { subset: true });

  // A compact half-A4 (A5-ish) page — smaller than the multi-page overview report.
  const W = 420;
  const H = 560;
  const margin = 36;
  const bottomLimit = margin; // never draw below this baseline
  const contentWidth = W - margin * 2;
  const ink = rgb(0.13, 0.15, 0.19);
  const muted = rgb(0.45, 0.47, 0.52);
  const accent = rgb(0.36, 0.22, 0.6);
  const rule = rgb(0.85, 0.86, 0.9);

  const width = (text: string, font: typeof body, size: number) => font.widthOfTextAtSize(text, size);

  let page = doc.addPage([W, H]);
  let y = H - margin;

  // Start a fresh page when the next block would cross the bottom margin. A tiny continuation marker
  // keeps every page honestly labelled as sample data.
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - margin;
    page.drawText('ข้อมูลตัวอย่าง (ต่อ)', {
      x: W - margin - width('ข้อมูลตัวอย่าง (ต่อ)', body, 9),
      y: y - 9,
      size: 9,
      font: body,
      color: muted,
    });
    y -= 18;
  };
  const ensure = (needed: number) => {
    if (y - needed < bottomLimit) newPage();
  };

  const line = (
    text: string,
    o: { font?: typeof body; size?: number; color?: typeof ink; gap?: number } = {},
  ) => {
    const font = o.font ?? body;
    const size = o.size ?? 10;
    const lh = size * 1.5;
    for (const l of wrapText(text, contentWidth, (s) => width(s, font, size))) {
      ensure(lh);
      page.drawText(l, { x: margin, y: y - size, size, font, color: o.color ?? ink });
      y -= lh;
    }
    if (o.gap) y -= o.gap;
  };

  // A label / value row. The value is right-aligned beside the label WHEN it fits (money, short refs);
  // otherwise it drops onto its own indented, wrapped line(s) so a long id / beneficiary / bank name
  // can NEVER overlap the label or leave the page. Money and Thai text are laid out verbatim, never
  // truncated or altered.
  const kv = (label: string, value: string, o: { bold?: boolean } = {}) => {
    const size = 10.5;
    const lh = size * 1.6;
    const valFont = o.bold ? bold : body;
    const labelWidth = width(label, body, size);
    const valueWidth = width(value, valFont, size);
    const gap = 12; // minimum breathing room between a label and an inline value
    if (labelWidth + gap + valueWidth <= contentWidth) {
      // Single inline row: label left, value right-aligned.
      ensure(lh);
      page.drawText(label, { x: margin, y: y - size, size, font: body, color: muted });
      page.drawText(value, {
        x: W - margin - valueWidth,
        y: y - size,
        size,
        font: valFont,
        color: ink,
      });
      y -= lh;
      return;
    }
    // Stacked row: the label on its own line, then the value wrapped and indented beneath it.
    ensure(lh);
    page.drawText(label, { x: margin, y: y - size, size, font: body, color: muted });
    y -= lh;
    const indent = 12;
    const valueColumn = contentWidth - indent;
    for (const l of wrapText(value, valueColumn, (s) => width(s, valFont, size))) {
      ensure(lh);
      page.drawText(l, { x: margin + indent, y: y - size, size, font: valFont, color: ink });
      y -= lh;
    }
  };

  const hr = () => {
    ensure(12);
    page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 0.8, color: rule });
    y -= 12;
  };

  // Header
  page.drawText('LabsD', { x: margin, y: y - 14, size: 15, font: bold, color: accent });
  page.drawText('ข้อมูลตัวอย่าง', {
    x: W - margin - width('ข้อมูลตัวอย่าง', body, 10),
    y: y - 12,
    size: 10,
    font: body,
    color: muted,
  });
  y -= 26;
  line('หลักฐานการถอนเงิน (เอกสารรับรองที่ระบบออก)', { font: bold, size: 12, gap: 2 });
  // Only the system-issued acknowledgment is ever rendered (provider slips are rejected above).
  line('ออกโดยระบบ LabsD (ยังไม่ใช่สลิปธนาคาร)', { size: 9.5, color: muted, gap: 6 });
  hr();

  // Fields
  kv('เลขอ้างอิงคำขอ', request.requestRef, { bold: true });
  kv('เลขที่เอกสาร', document.documentId);
  const beneficiaryName = input.displayName ?? request.beneficiary.displayName;
  kv('ผู้รับเงิน', beneficiaryName);
  kv('บัญชีรับเงิน', `${request.beneficiary.bankName} ${request.beneficiary.maskedAccount}`);
  kv('วันที่ชำระเงิน', bangkokThaiDateTime(document.issuedAt));
  y -= 4;
  hr();

  // Money breakdown
  kv('ยอดก่อนหัก', thb(request.gross.minor));
  for (const d of request.deductions) kv(d.label, `- ${thb(d.amount.minor)}`);
  kv('ยอดสุทธิที่โอน', thb(document.net.minor), { bold: true });
  y -= 4;
  hr();

  // Disclosure — no tax-invoice / receipt / bank-slip / signature claim.
  line(
    'เอกสารนี้เป็นข้อมูลตัวอย่างจากระบบ ไม่ใช่ใบกำกับภาษีหรือใบเสร็จรับเงินตามกฎหมาย และไม่ใช่สลิปธนาคาร',
    { size: 9, color: muted, gap: 2 },
  );
  line('ไม่มีการลงลายมือชื่อหรือตราสัญลักษณ์ธนาคาร', { size: 9, color: muted });

  const bytes = await doc.save();
  return bytes as Uint8Array;
}

// A minimal blob download (kept local so this module never edits the shared report-export helper).
function triggerDownload(data: BlobPart, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// The explicit-click download. There is NO success proof for a non-paid request: this throws unless
// the request is settled (`paid`) AND the documents section is `available`. It selects the document by
// id when supplied, else the first available one, and re-checks the descriptor scope/net before
// rendering.
//
// Cancellation: an optional `signal` lets the caller abort a download that outlived its scope (a
// route change / component unmount). The signal is checked BEFORE any work and AGAIN immediately
// before the Blob is created and the save is triggered — so if the scope changed at ANY point during
// the awaited PDF rendering, the download is thrown (`AbortError`) and NO file is ever saved. The
// signal is optional, so the pre-existing three-argument callers stay compatible unchanged.
export async function downloadWithdrawalProof(
  detail: WithdrawalRequestDetailValue,
  displayName?: string,
  documentId?: string,
  signal?: AbortSignal,
): Promise<void> {
  // (1) Abort check before any work.
  throwIfAborted(signal);
  if (detail.request.status !== 'paid')
    throw new Error('A withdrawal proof is available only for a settled (paid) withdrawal');
  if (detail.documents.state !== 'available')
    throw new Error('No proof document is available for this withdrawal');
  const documents = detail.documents.documents;
  const proofDocument =
    documentId !== undefined ? documents.find((d) => d.documentId === documentId) : documents[0];
  if (!proofDocument) throw new Error('The requested proof document was not found');
  if (proofDocument.requestRef !== detail.request.requestRef)
    throw new Error('The proof document does not belong to this withdrawal');
  if (proofDocument.net.minor !== detail.request.net.minor)
    throw new Error('The proof document net does not match the withdrawal net');
  // Never fabricate a provider bank slip — refuse honestly before rendering.
  assertGeneratable(proofDocument);
  const bytes = await buildWithdrawalProofPdf({
    document: proofDocument,
    request: detail.request,
    displayName,
  });
  // (2) Abort check immediately before the Blob/save action, AFTER all awaited rendering — a scope
  // change during rendering must prevent the file from ever being saved.
  throwIfAborted(signal);
  triggerDownload(
    bytes as unknown as BlobPart,
    'application/pdf',
    `labsd-withdrawal-proof-${detail.request.requestRef}.pdf`,
  );
}
