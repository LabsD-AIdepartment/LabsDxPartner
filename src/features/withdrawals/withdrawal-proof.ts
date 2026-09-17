import type {
  WithdrawalProofDocumentValue,
  WithdrawalRequestDetailValue,
  WithdrawalRequestValue,
} from '@/contracts/withdrawal-journey';
import { wrapText } from '@/features/overview/report-export';
import { formatMinor } from '@/shared/ui/format-money';

// Shared-theme A4 withdrawal document renderer for a settled withdrawal —
// using the same licensed font families as the web, shared PDF cards and the `wrapText` helper
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
// net without triggering a browser download. Long identifiers / beneficiary + bank names / a full set
// of deduction lines never overlap a label or run off the page: a value that does not fit beside its
// label wraps onto its own indented line(s), and the whole document paginates (bounded, because every
// contract field is length-bounded and deductions are capped at 10) rather than drawing past the
// bottom margin.
export async function buildWithdrawalProofPdf(input: WithdrawalProofInput): Promise<Uint8Array> {
  const { document, request } = input;
  assertGeneratable(document);
  const [{ PDFDocument }, { embedDocumentFonts, drawPdfCard, pdfColors }] = await Promise.all([
    import('pdf-lib'),
    import('@/shared/documents/pdf-theme'),
  ]);
  const doc = await PDFDocument.create();
  const { body, bold } = await embedDocumentFonts(doc);
  doc.setTitle(`บันทึกการถอนเงิน - ${request.requestRef}`);
  doc.setAuthor('Labs D');
  doc.setSubject('บันทึกรายการจ่ายเงินจากระบบ Labs D');
  const W = 595.28,
    H = 841.89,
    margin = 44,
    bottom = 76;
  const contentWidth = W - margin * 2;
  const { ink, muted, accent, rule, greenSurface } = pdfColors;
  let page = doc.addPage([W, H]);
  let y = H - margin;
  const width = (text: string, font = body, size = 11) => font.widthOfTextAtSize(text, size);
  const wrapped = (text: string, max: number, font = body, size = 11) =>
    wrapText(text, max, (value) => width(value, font, size));
  const text = (value: string, x: number, top: number, size = 11, font = body, color = ink) =>
    page.drawText(value, { x, y: top - size, size, font, color });
  const header = (continued = false) => {
    text('Labs D', margin, y, 23, bold);
    text('PARTNER', margin + 88, y - 7, 9, body, muted);
    const category = 'WITHDRAWAL RECORD';
    text(category, W - margin - width(category, body, 8), y - 8, 8, body, muted);
    y -= 46;
    text(continued ? 'บันทึกการถอนเงิน (ต่อ)' : 'บันทึกการถอนเงิน', margin, y, 22, bold);
    y -= 34;
    text('รายละเอียดรายการและยอดจ่ายให้พาร์ทเนอร์', margin, y, 10, body, muted);
    y -= 30;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - margin;
    header(true);
  };
  header();

  type Field = { label: string; value: string; strong?: boolean };
  // Rows are measured before painting. A card splits only between complete rows, and repeats its
  // heading on continuation pages. Long names, identifiers and deductions retain their full text.
  const fieldCard = (title: string, fields: Field[]) => {
    const inset = 20,
      labelW = 133,
      gap = 16,
      lineHeight = 17;
    const valueW = contentWidth - inset * 2 - labelW - gap;
    const rows = fields.map((field) => {
      const labels = wrapped(field.label, labelW, body, 10);
      const values = wrapped(field.value, valueW, field.strong ? bold : body, 11);
      return {
        ...field,
        labels,
        values,
        height: Math.max(labels.length, values.length) * lineHeight + 12,
      };
    });
    let offset = 0;
    while (offset < rows.length) {
      const cap = 51,
        tail = 10;
      if (y - cap - rows[offset].height - tail < bottom) newPage();
      const batch: typeof rows = [];
      let h = cap + tail;
      while (offset < rows.length && y - h - rows[offset].height >= bottom) {
        h += rows[offset].height;
        batch.push(rows[offset++]);
      }
      // Contract fields are bounded, but an unrestricted caller display name may be longer than a
      // page. Slice such a value across continuation cards rather than loop or clip it.
      if (batch.length === 0) {
        const row = rows[offset];
        const take = Math.max(1, Math.floor((y - bottom - cap - tail - 12) / lineHeight));
        batch.push({
          ...row,
          labels: row.labels.slice(0, take),
          values: row.values.slice(0, take),
          height: take * lineHeight + 12,
        });
        row.labels = row.labels.slice(take);
        row.values = row.values.slice(take);
        row.height = Math.max(row.labels.length, row.values.length) * lineHeight + 12;
        h += take * lineHeight + 12;
        if (!row.labels.length && !row.values.length) offset++;
      }
      drawPdfCard(page, { x: margin, y: y - h, width: contentWidth, height: h });
      text(title, margin + inset, y - 17, 12, bold);
      let top = y - cap;
      for (const row of batch) {
        row.labels.forEach((line, i) =>
          text(line, margin + inset, top - i * lineHeight, 10, body, muted),
        );
        row.values.forEach((line, i) =>
          text(
            line,
            margin + inset + labelW + gap,
            top - i * lineHeight,
            11,
            row.strong ? bold : body,
          ),
        );
        top -= row.height;
      }
      y -= h + 16;
    }
  };
  fieldCard('ข้อมูลรายการ', [
    { label: 'เลขอ้างอิงคำขอ', value: request.requestRef, strong: true },
    { label: 'เลขที่เอกสาร', value: document.documentId },
    { label: 'วันที่ชำระเงิน', value: bangkokThaiDateTime(document.issuedAt) },
  ]);
  fieldCard('ผู้รับเงิน', [
    {
      label: 'ชื่อผู้รับเงิน',
      value: input.displayName ?? request.beneficiary.displayName,
      strong: true,
    },
    { label: 'ธนาคาร', value: request.beneficiary.bankName },
    { label: 'เลขที่บัญชี', value: request.beneficiary.maskedAccount },
  ]);
  fieldCard('รายละเอียดจำนวนเงิน', [
    { label: 'ยอดก่อนหัก', value: thb(request.gross.minor) },
    ...request.deductions.map((d) => ({ label: d.label, value: `- ${thb(d.amount.minor)}` })),
  ]);
  const net = thb(document.net.minor);
  let size = 28;
  while (size > 12 && width(net, bold, size) > contentWidth - 40) size -= 0.5;
  const netLines = wrapped(net, contentWidth - 40, bold, size);
  const netH = 57 + netLines.length * (size * 1.4);
  if (y - netH < bottom) newPage();
  drawPdfCard(page, {
    x: margin,
    y: y - netH,
    width: contentWidth,
    height: netH,
    color: greenSurface,
  });
  text('ยอดสุทธิที่โอน', margin + 20, y - 16, 11, body, muted);
  netLines.forEach((line, i) =>
    text(line, margin + 20, y - 39 - i * size * 1.4, size, bold, accent),
  );

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: margin, y: 59 },
      end: { x: W - margin, y: 59 },
      thickness: 0.6,
      color: rule,
    });
    p.drawText('เอกสารอ้างอิงรายการในระบบ Labs D', {
      x: margin,
      y: 42,
      size: 8,
      font: body,
      color: muted,
    });
    const count = `${i + 1} / ${pages.length}`;
    p.drawText(count, {
      x: W - margin - width(count, body, 8),
      y: 42,
      size: 8,
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
