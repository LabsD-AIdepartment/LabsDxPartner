import type {
  WithdrawalProofDocumentValue,
  WithdrawalRequestDetailValue,
  WithdrawalRequestValue,
} from '@/contracts/withdrawal-journey';
import { wrapText } from '@/features/overview/report-export';
import { formatMinor } from '@/shared/ui/format-money';
import { pitchVoucherIssuer } from './voucher-presentation';

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
  // The existing filled-data pitch lane may show owner-authorized fictional issuer details.
  // Other scopes retain source-only documents, with no invented issuer or stamp.
  const issuer = request.scope.scenario === 'partner-demo' ? pitchVoucherIssuer : null;
  assertGeneratable(document);
  const [{ PDFDocument }, { embedDocumentFonts, pdfColors }] = await Promise.all([
    import('pdf-lib'),
    import('@/shared/documents/pdf-theme'),
  ]);
  const doc = await PDFDocument.create();
  const { body, bold } = await embedDocumentFonts(doc);
  doc.setTitle(`ใบสำคัญจ่าย - ${request.requestRef}`);
  doc.setAuthor('Labs D');
  doc.setSubject('รายละเอียดการจ่ายเงินให้พาร์ทเนอร์');
  const W = 595.28,
    H = 841.89,
    margin = 48 * 1.3,
    topMargin = 48,
    bottom = 78;
  const right = W - margin,
    contentWidth = W - margin * 2;
  const { ink, muted, rule } = pdfColors;
  const size = 9.5,
    leading = 15;
  let page = doc.addPage([W, H]);
  let y = H - topMargin;
  let pageBodyTop = y;
  const width = (value: string, font = body, fontSize = size) =>
    font.widthOfTextAtSize(value, fontSize);
  const wrap = (value: string, max: number, font = body, fontSize = size) =>
    wrapText(value, max, (line) => width(line, font, fontSize));
  const text = (value: string, x: number, top: number, fontSize = size, font = body, color = ink) =>
    page.drawText(value, { x, y: top - fontSize, size: fontSize, font, color });
  const line = (top: number, x = margin, end = right, color = rule, thickness = 0.4) =>
    page.drawLine({ start: { x, y: top }, end: { x: end, y: top }, color, thickness });
  const originalColumnX = margin + contentWidth * 0.56;
  const columnSpareSpace = right - originalColumnX - width('ใบสำคัญจ่าย', bold, 20);
  const rightColumnX = originalColumnX + Math.max(0, columnSpareSpace) * 0.5;
  const header = (continued = false) => {
    // Align visible glyph tops: bundled Latin at 22pt sits 3.14pt below Thai at 20pt.
    text('Labs D', margin, y + 3.14, 22, bold);
    text('PARTNER', margin, y - 29, 8, body, muted);
    const issuerLines = issuer
      ? [
          issuer.legalName,
          ...issuer.address.split('\n'),
          `เลขผู้เสียภาษี ${issuer.taxId}`,
          issuer.branch,
        ]
      : [];
    issuerLines.forEach((value, i) => text(value, margin, y - 47 - i * 12, 8, body, muted));
    const headerX = rightColumnX;
    const headerW = right - headerX;
    text(continued ? 'ใบสำคัญจ่าย (ต่อ)' : 'ใบสำคัญจ่าย', headerX, y, 20, bold);
    text('PAYMENT VOUCHER', headerX, y - 29, 8, body, muted);
    const ids = wrap('เลขที่ ' + document.documentId, headerW, body, 8);
    ids.forEach((value, i) => text(value, headerX, y - 47 - i * 12, 8, body, muted));
    y -= Math.max(68 + ids.length * 12, issuerLines.length ? 68 + issuerLines.length * 12 : 0);
    pageBodyTop = y;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - topMargin;
    header(true);
  };
  header();

  const leftW = contentWidth * 0.5;
  const detailX = rightColumnX;
  type Detail = { value: string; heading?: boolean };
  const details = (label: string, value: string, max: number): Detail[] => [
    { value: label, heading: true },
    ...wrap(value, max).map((line) => ({ value: line })),
    { value: '' },
  ];
  const columns = [
    [
      ...details('ผู้รับเงิน', input.displayName ?? request.beneficiary.displayName, leftW),
      ...details('บัญชีรับเงิน', request.beneficiary.bankName, leftW),
      ...wrap(request.beneficiary.maskedAccount, leftW).map((value) => ({ value })),
    ] as Detail[],
    [
      ...details('วันที่ชำระเงิน', bangkokThaiDateTime(document.issuedAt), right - detailX),
      ...details('เลขอ้างอิงคำขอ', request.requestRef, right - detailX),
    ],
  ];
  const detailCount = Math.max(...columns.map((column) => column.length));
  for (let i = 0; i < detailCount; i++) {
    if (y - leading < bottom) newPage();
    columns.forEach((column, index) => {
      const entry = column[i];
      if (entry?.value)
        text(
          entry.value,
          index === 0 ? margin : detailX,
          y,
          entry.heading ? 8 : size,
          entry.heading ? bold : body,
          entry.heading ? muted : ink,
        );
    });
    y -= leading;
  }
  y -= 24;

  // Voucher table: only source rows, without invoice-specific quantity, tax or fabricated services.
  const numberW = 34,
    amountW = 148;
  const descriptionX = margin + numberW;
  const descriptionW = contentWidth - numberW - amountW - 16;
  const tableHeader = () => {
    line(y);
    text('ลำดับ', margin + 4, y - 9, 8, bold, muted);
    text('รายการ', descriptionX, y - 9, 8, bold, muted);
    const label = 'จำนวนเงิน (บาท)';
    text(label, right - 8 - width(label, bold, 8), y - 9, 8, bold, muted);
    y -= 30;
    line(y);
  };
  if (y - 62 < bottom) newPage();
  tableHeader();
  let tableBodyTop = y;
  const verticals = (top: number, end: number) => {
    for (const x of [descriptionX - 8, right - amountW])
      page.drawLine({
        start: { x, y: top },
        end: { x, y: end },
        color: rule,
        thickness: 0.4,
      });
  };
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
      verticals(tableBodyTop, y);
      newPage();
      tableHeader();
      tableBodyTop = y;
    }
    for (let i = 0; i < count; i++) {
      if (y - leading - 14 < bottom) {
        verticals(tableBodyTop, y);
        newPage();
        tableHeader();
        tableBodyTop = y;
      }
      if (i === 0) text(String(index + 1).padStart(2, '0'), margin + 4, y - 9, 8, body, muted);
      if (labels[i]) text(labels[i], descriptionX, y - 9);
      if (amounts[i]) text(amounts[i], right - 8 - width(amounts[i]), y - 9);
      y -= leading;
    }
    y -= 17;
    line(y);
  });

  // A short voucher retains blank ruled writing space without inventing transaction rows.
  if (rows.length < 5) {
    const blankHeight = (5 - rows.length) * 28;
    if (y - blankHeight >= bottom) {
      for (let i = rows.length; i < 5; i++) {
        y -= 28;
        line(y);
      }
    }
  }
  verticals(tableBodyTop, y);

  const totalX = right - 224,
    amountMax = 130;
  const deductions = request.deductions.reduce((sum, item) => sum + BigInt(item.amount.minor), 0n);
  const totals = [
    { label: 'ยอดเบิก', amount: thb(request.gross.minor), strong: false },
    { label: 'รายการหักรวม', amount: thb(deductions.toString()), strong: false },
    { label: 'ยอดสุทธิที่โอน', amount: thb(document.net.minor), strong: true },
  ].map((row) => ({
    ...row,
    lines: wrap(row.amount, amountMax, row.strong ? bold : body, row.strong ? 11 : size),
  }));
  const totalHeight = totals.reduce((sum, row) => sum + row.lines.length * leading + 12, 12);
  if (y - Math.max(totalHeight, issuer ? 112 : 0) < bottom) newPage();
  const totalTop = y - 14;
  text('ผู้ออกเอกสาร', margin, totalTop, 8, bold);
  text(issuer?.legalName ?? 'Labs D', margin, totalTop - 16, 8.5, body, muted);
  if (issuer) {
    text('ติดต่อฝ่ายบัญชี', margin, totalTop - 46, 8, bold);
    [issuer.phone, issuer.email, issuer.website].forEach((value, i) =>
      text(value, margin, totalTop - 62 - i * 12, 8, body, muted),
    );
  }
  y = totalTop;
  for (const row of totals) {
    if (row.strong) {
      line(y + 4, totalX, right);
      y -= 6;
    }
    text(row.label, totalX, y, 8, row.strong ? bold : body);
    row.lines.forEach((value, i) =>
      text(
        value,
        right - width(value, row.strong ? bold : body, row.strong ? 11 : size),
        y - i * leading,
        row.strong ? 11 : size,
        row.strong ? bold : body,
      ),
    );
    y -= row.lines.length * leading + 10;
  }

  // Pitch-only brand stamp: a design fixture, never an approval/signature or payment assertion.
  const stampHeight = 96;
  if (y - stampHeight < bottom) newPage();
  const stampCenterX = (totalX + right) / 2;
  if (issuer) {
    const stampCenterY = y - 43;
    for (const radius of [35, 31])
      page.drawCircle({
        x: stampCenterX,
        y: stampCenterY,
        size: radius,
        borderWidth: 0.5,
        borderColor: muted,
      });
    const stampText = (value: string, top: number, fontSize: number, font = body) =>
      text(value, stampCenterX - width(value, font, fontSize) / 2, top, fontSize, font, muted);
    stampText('Labs D', stampCenterY + 12, 13, bold);
    stampText('PARTNER', stampCenterY - 7, 6.5);
    stampText('COMPANY SEAL', stampCenterY - 17, 5);
  }
  y -= stampHeight;
  const stampLabel = 'ตราประทับบริษัท';
  text(stampLabel, totalX + (right - totalX - width(stampLabel, body, 8)) / 2, y, 8, body, muted);

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: margin, y: 59 },
      end: { x: right, y: 59 },
      thickness: 0.4,
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
