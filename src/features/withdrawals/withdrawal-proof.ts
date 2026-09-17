import type {
  WithdrawalProofDocumentValue,
  WithdrawalRequestDetailValue,
  WithdrawalRequestValue,
} from '@/contracts/withdrawal-journey';
import { wrapText } from '@/features/overview/report-export';
import { formatMinor } from '@/shared/ui/format-money';

// Shared-theme A4 withdrawal document renderer for a settled withdrawal —
// using the same licensed font families as the web, shared PDF theme and the `wrapText` helper
// — WITHOUT copying the hundred-line overview report renderer. It renders an immutable snapshot of the
// paid request (reference, masked beneficiary, gross, deductions, net and the paid instant) plus a
// system-issued record identity. It makes NO tax-invoice / signature /
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
        'download exists yet. Only the system-issued acknowledgment (Labs D) is available.',
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

const thb = (minor: string): string => formatMinor(minor);

// Build the compact proof PDF bytes. Exposed so a test can assert selectable Thai text + the correct
// net without triggering a browser download. Long values wrap within measured columns, and
// continued details/table rows paginate before crossing the footer. No content is truncated.
export async function buildWithdrawalProofPdf(input: WithdrawalProofInput): Promise<Uint8Array> {
  const { document, request } = input;
  assertGeneratable(document);
  const [{ PDFDocument }, { embedDocumentFonts, pdfColors }] = await Promise.all([
    import('pdf-lib'),
    import('@/shared/documents/pdf-theme'),
  ]);
  const doc = await PDFDocument.create();
  const { body, bold } = await embedDocumentFonts(doc);
  doc.setTitle(`ใบสรุปการเบิกจ่าย - ${request.requestRef}`);
  doc.setAuthor('Labs D');
  doc.setSubject('รายละเอียดการจ่ายเงินให้พาร์ทเนอร์');
  const W = 595.28,
    H = 841.89,
    margin = 48,
    bottom = 78;
  const right = W - margin,
    contentWidth = W - margin * 2;
  const { ink, muted, rule } = pdfColors;
  const size = 9.5,
    leading = 15;
  let page = doc.addPage([W, H]);
  let y = H - margin;
  let pageBodyTop = y;
  const width = (value: string, font = body, fontSize = size) =>
    font.widthOfTextAtSize(value, fontSize);
  const wrap = (value: string, max: number, font = body, fontSize = size) =>
    wrapText(value, max, (line) => width(line, font, fontSize));
  const text = (value: string, x: number, top: number, fontSize = size, font = body, color = ink) =>
    page.drawText(value, { x, y: top - fontSize, size: fontSize, font, color });
  const line = (top: number, x = margin, end = right, color = rule, thickness = 0.6) =>
    page.drawLine({ start: { x, y: top }, end: { x: end, y: top }, color, thickness });
  const header = (continued = false) => {
    text('Labs D', margin, y, 9, bold, muted);
    const date = 'วันที่ชำระเงิน ' + bangkokThaiDateTime(document.issuedAt);
    text(date, right - width(date, body, 8), y, 8, body, muted);
    y -= 28;
    text(continued ? 'ใบสรุปการเบิกจ่าย (ต่อ)' : 'ใบสรุปการเบิกจ่าย', margin, y, 24, bold);
    y -= 39;
    const ids = wrap('เลขที่เอกสาร ' + document.documentId, contentWidth, body, 8);
    ids.forEach((value, i) => text(value, margin, y - i * 12, 8, body, muted));
    y -= ids.length * 12 + 40;
    pageBodyTop = y;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - margin;
    header(true);
  };
  header();

  // A restrained label/value grid, with no card surfaces or decorative fields.
  const labelW = 104;
  const fields = [
    { label: 'ผู้ออกเอกสาร', value: 'Labs D', gap: 14 },
    { label: 'ผู้รับเงิน', value: input.displayName ?? request.beneficiary.displayName, gap: 14 },
    { label: 'ธนาคาร', value: request.beneficiary.bankName, gap: 5 },
    { label: 'เลขที่บัญชี', value: request.beneficiary.maskedAccount, gap: 5 },
    { label: 'เลขอ้างอิงคำขอ', value: request.requestRef, gap: 0 },
  ];
  for (const field of fields) {
    const values = wrap(field.value, contentWidth - labelW);
    values.forEach((value, i) => {
      if (y - leading < bottom) newPage();
      if (i === 0) text(field.label, margin, y, 8.5, bold);
      text(value, margin + labelW, y, size, body, muted);
      y -= leading;
    });
    y -= field.gap;
  }
  y -= 50;

  // Voucher table: only source rows, without invoice-specific quantity, tax or fabricated services.
  const numberW = 34,
    amountW = 148;
  const descriptionX = margin + numberW;
  const descriptionW = contentWidth - numberW - amountW - 16;
  const tableHeader = () => {
    text('ลำดับ', margin + 4, y - 9, 8, bold, muted);
    text('รายการ', descriptionX, y - 9, 8, bold, muted);
    const label = 'จำนวนเงิน (บาท)';
    text(label, right - 8 - width(label, bold, 8), y - 9, 8, bold, muted);
    y -= 30;
    line(y);
  };
  if (y - 62 < bottom) newPage();
  tableHeader();
  const rows = [
    { label: 'ยอดเบิกตามคำขอถอนเงิน', amount: thb(request.gross.minor) },
    ...request.deductions.map((d) => ({ label: d.label, amount: `- ${thb(d.amount.minor)}` })),
  ];
  rows.forEach((row, index) => {
    const labels = wrap(row.label, descriptionW);
    const amounts = wrap(row.amount, amountW - 16);
    const count = Math.max(labels.length, amounts.length);
    const rowHeight = count * leading + 17;
    if (y - rowHeight < bottom && rowHeight <= pageBodyTop - 30 - bottom) {
      newPage();
      tableHeader();
    }
    for (let i = 0; i < count; i++) {
      if (y - leading - 14 < bottom) {
        newPage();
        tableHeader();
      }
      if (i === 0) text(String(index + 1).padStart(2, '0'), margin + 4, y - 9, 8, body, muted);
      if (labels[i]) text(labels[i], descriptionX, y - 9);
      if (amounts[i]) text(amounts[i], right - 8 - width(amounts[i]), y - 9);
      y -= leading;
    }
    y -= 17;
    line(y);
  });

  // One right-aligned total, with a quiet label and no decorative box.
  const totalW = 280;
  const netLines = wrap(thb(document.net.minor), totalW, body, 24);
  const totalH = 35 + netLines.length * 32;
  if (y - totalH - 38 < bottom) newPage();
  y -= 32;
  const totalLabel = 'ยอดสุทธิที่โอน';
  text(totalLabel, right - width(totalLabel, body, 8), y, 8, body, muted);
  y -= 20;
  netLines.forEach((value, i) => text(value, right - width(value, body, 24), y - i * 32, 24));

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: margin, y: 59 },
      end: { x: right, y: 59 },
      thickness: 0.6,
      color: rule,
    });
    p.drawText('Labs D · เอกสารอ้างอิงรายการจ่ายเงิน', {
      x: margin,
      y: 42,
      size: 7.5,
      font: body,
      color: muted,
    });
    const count = `${i + 1} / ${pages.length}`;
    p.drawText(count, {
      x: right - width(count, body, 7.5),
      y: 42,
      size: 7.5,
      font: body,
      color: muted,
    });
  });
  return doc.save();
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
