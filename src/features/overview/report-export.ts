import { Overview, type OverviewValue, type SalesPlatformName } from '@/contracts/overview';
import { QueryFilters } from '@/contracts/common';
import { formatMinor } from '@/shared/ui/format-money';
import { dateLabel, timestamp } from '@/shared/ui/format-date';
import type { FilterValue } from '@/shared/ui/FilterBar';

/**
 * General Overview report export (CSV + PDF).
 *
 * The UI dynamically imports this module and calls {@link downloadOverviewReport} only on an
 * explicit format choice, over an immutable snapshot of the currently authorised Overview scope.
 * Nothing here fetches, authenticates or reaches a network/API: it renders ONLY the loaded
 * {@link OverviewValue} plus its matching filters. This is a general clip/commission range report —
 * NOT an invoice/receipt/legal issuance and NOT a wallet snapshot, so it never invents a tax id,
 * signature, payment instruction, or any available/reserved balance (the input carries no
 * withdrawal state).
 *
 * Financial honesty rules enforced throughout:
 *  - Money is exact: satang (integer THB minor) → two decimals via BigInt, never float.
 *  - Unknown (null) is NOT zero: a missing figure prints an explicit "unavailable" token.
 *  - Coverage/status/estimate context is surfaced only when it matters, so partial or projected
 *    figures are honest without cluttering an otherwise clean report.
 */
export type OverviewReportInput = {
  data: OverviewValue;
  filters: FilterValue;
  partnerName: string;
};

const UNAVAILABLE = 'unavailable';
const UNAVAILABLE_TH = 'ไม่พร้อมใช้งาน';

/** Human labels for the daily sales-platform breakdown, in a fixed display order. */
const PLATFORM_LABEL: Record<SalesPlatformName, string> = {
  facebook: 'Facebook',
  tiktok: 'TikTok',
  shopee: 'Shopee',
  lazada: 'Lazada',
  web: 'เว็บไซต์',
  unattributed: 'ไม่ระบุช่องทาง',
};

/** Exact satang → decimal string ("3736000" → "37360.00"). Mirrors the server statement export. */
export function decimalMinor(minor: string): string {
  const amount = BigInt(minor);
  const abs = amount < 0n ? -amount : amount;
  return (amount < 0n ? '-' : '') + String(abs / 100n) + '.' + String(abs % 100n).padStart(2, '0');
}

/**
 * RFC 4180 quoting plus spreadsheet formula-injection neutralisation. Every textual field —
 * partner name, brand, clip title, reasons — passes through this before entering a CSV cell.
 */
export function csvText(value: string): string {
  return (
    '"' + (/^(?:\s*[=+@-]|[\t\r\n])/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"'
  );
}

/** parts-per-million rate → exact percent string ("100000" → "10%", "5000" → "0.5%"). */
export function ratePercent(ppm: number): string {
  const whole = Math.trunc(ppm / 10000);
  const frac = Math.abs(ppm % 10000)
    .toString()
    .padStart(4, '0')
    .replace(/0+$/, '');
  return `${whole}${frac ? '.' + frac : ''}%`;
}

export type MoneyCell = { minor: string } | null;
export type CountCell = number | null;

export type OverviewReportModel = {
  partnerName: string;
  fromLabel: string;
  inclusiveEndLabel: string;
  rangeIso: { from: string; toExclusive: string };
  brandLabel: string;
  dataState: OverviewValue['dataState'];
  coverageStatus: 'complete' | 'partial' | 'unavailable';
  coveragePeriods: { from: string; toExclusive: string }[];
  dataThrough: string | null;
  generatedAt: string;
  requestId: string;
  reasons: string[];
  summary: { key: string; label: string; amount: MoneyCell }[];
  counts: { key: string; label: string; count: CountCell }[];
  daily: {
    date: string;
    minor: string;
    sales: MoneyCell;
    platforms: { platform: SalesPlatformName; minor: string }[] | null;
  }[];
  brands: { label: string; minor: string }[] | null;
  channels: { key: string; label: string; minor: string; ratePpm: number | null }[] | null;
  topClips: {
    title: string;
    brand: string;
    publishedAt: string;
    earned: MoneyCell;
    unavailableReason: string | null;
  }[];
  statusNote: string | null;
  estimatedNote: string | null;
  unassignedNote: string | null;
};

export type ValidatedReportInput = {
  data: OverviewValue;
  filters: { from: string; toExclusive: string; brand: string | null };
  partnerName: string;
};

/**
 * Validate the snapshot before generating anything. We do not trust the caller's shapes:
 * the payload is re-parsed against the Overview contract, the filters against QueryFilters, and
 * the selected window MUST equal the loaded earnings period (the same guard loadOverview applies).
 * Any mismatch throws so a stale or cross-scope snapshot can never be exported as authoritative.
 */
export function assertOverviewReportScope(input: OverviewReportInput): ValidatedReportInput {
  const data = Overview.parse(input.data);
  const filters = QueryFilters.safeParse(input.filters);
  if (!filters.success) throw new Error('Invalid report filters');
  const expectedFrom = Date.parse(filters.data.from + 'T00:00:00+07:00');
  const expectedTo = Date.parse(filters.data.toExclusive + 'T00:00:00+07:00');
  if (
    Date.parse(data.earnings.period.from) !== expectedFrom ||
    Date.parse(data.earnings.period.toExclusive) !== expectedTo
  )
    throw new Error('Report filters do not match the loaded Overview period');
  const partnerName = input.partnerName.trim();
  if (!partnerName) throw new Error('Report requires a partner name');
  return {
    data,
    filters: {
      from: filters.data.from,
      toExclusive: filters.data.toExclusive,
      brand: filters.data.brand,
    },
    partnerName,
  };
}

/** Human-readable INCLUSIVE last day for an exclusive-end window (Oct 1 exclusive → "30 ก.ย."). */
function inclusiveEndInstant(toExclusive: string): string {
  return new Date(Date.parse(toExclusive + 'T00:00:00+07:00') - 86_400_000).toISOString();
}

/**
 * Shared structured model consumed by both the CSV and PDF renderers, so the two formats always
 * report identical figures. Money stays as satang strings here; each renderer formats exactly.
 */
export function buildOverviewReportModel(input: OverviewReportInput): OverviewReportModel {
  const { data, filters, partnerName } = assertOverviewReportScope(input);
  const e = data.earnings;
  const coverageStatus = e.coverage.status;

  const summary = [
    { key: 'confirmed', label: 'คอมมิชชันที่ยืนยันแล้ว', amount: e.confirmed },
    { key: 'estimated', label: 'ประมาณการ (ยังไม่ยืนยัน)', amount: e.estimated },
    { key: 'eligible_sales', label: 'ยอดขายที่นำมาคำนวณ', amount: e.eligibleSales },
    { key: 'unassigned', label: 'รายได้รอจับคู่คลิป', amount: e.unassignedAmount },
  ];

  const counts = [
    { key: 'content_count', label: 'จำนวนคลิปที่สร้างรายได้', count: e.contentCount },
    { key: 'excluded_count', label: 'รายการที่ยกเว้น', count: e.excludedCount },
  ];

  const daily = e.trend.map((point) => ({
    date: point.date,
    minor: point.amount.minor,
    // Unknown daily sales stays null (an explicit "unavailable" token downstream), never zero.
    sales: point.sales ?? null,
    platforms: point.salesByPlatform
      ? point.salesByPlatform.map((entry) => ({
          platform: entry.platform,
          minor: entry.sales.minor,
        }))
      : null,
  }));
  const brands = e.salesByBrand
    ? e.salesByBrand.map((row) => ({ label: row.label, minor: row.value.minor }))
    : null;
  const channels = e.channelBreakdown
    ? [
        {
          key: 'organic',
          label: 'Organic',
          minor: e.channelBreakdown.organic.minor,
          ratePpm: e.channelBreakdown.organicRatePpm,
        },
        {
          key: 'brand_ads',
          label: 'Brand ads',
          minor: e.channelBreakdown.brandAds.minor,
          ratePpm: e.channelBreakdown.brandAdsRatePpm,
        },
        {
          key: 'other',
          label: 'อื่น ๆ',
          minor: e.channelBreakdown.other.minor,
          ratePpm: null,
        },
      ]
    : null;

  // Explicitly the TOP clips (a highlight), never the full ledger — the report never claims to be
  // an exhaustive line-by-line statement.
  const topClips = e.topContent.map((clip) => ({
    title: clip.title,
    brand: clip.brand,
    publishedAt: clip.publishedAt,
    earned: clip.earned,
    unavailableReason: clip.unavailableReason,
  }));

  const statusNote =
    coverageStatus === 'unavailable'
      ? 'ต้นทางยังไม่พร้อมให้ข้อมูลรอบนี้ ตัวเลขทางการเงินจึงยังไม่พร้อมใช้งาน (ไม่ใช่ศูนย์)'
      : coverageStatus === 'partial'
        ? 'ข้อมูลครอบคลุมเพียงบางช่วงของกรอบเวลาที่เลือก ตัวเลขจึงเป็นยอดเฉพาะช่วงที่มีข้อมูล'
        : data.dataState !== 'ready' && data.reasons.length
          ? data.reasons.join(' · ')
          : null;

  const estimatedNote =
    e.estimated && BigInt(e.estimated.minor) !== 0n
      ? 'ประมาณการแยกจากคอมมิชชันที่ยืนยันแล้ว และอาจเปลี่ยนแปลงก่อนตัดรอบ'
      : null;

  const unassignedNote =
    e.unassignedAmount && BigInt(e.unassignedAmount.minor) !== 0n
      ? 'มีรายได้บางส่วนที่ยังจับคู่กับคลิปไม่ได้ จึงไม่ปรากฏในยอดแยกตามคลิป'
      : null;

  return {
    partnerName,
    fromLabel: dateLabel(filters.from + 'T00:00:00+07:00'),
    inclusiveEndLabel: dateLabel(inclusiveEndInstant(filters.toExclusive)),
    rangeIso: { from: filters.from, toExclusive: filters.toExclusive },
    brandLabel: filters.brand ?? 'ทุกแบรนด์',
    dataState: data.dataState,
    coverageStatus,
    coveragePeriods: e.coverage.periods.map((p) => ({ from: p.from, toExclusive: p.toExclusive })),
    dataThrough: data.dataThrough,
    generatedAt: data.generatedAt,
    requestId: data.requestId,
    reasons: data.reasons,
    summary,
    counts,
    daily,
    brands,
    channels,
    topClips,
    statusNote,
    estimatedNote,
    unassignedNote,
  };
}

/** Human-safe base filename (no extension), ascii-slugged from partner + selected window. */
export function reportBaseFilename(input: OverviewReportInput): string {
  const { partnerName, filters } = assertOverviewReportScope(input);
  const slug =
    partnerName
      .normalize('NFKD')
      .replace(/[^\w]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toLowerCase() || 'partner';
  return `overview-report_${slug}_${filters.from}_to_${filters.toExclusive}`;
}

// -------------------------------------------------------------------------------------------------
// Text wrapping
// -------------------------------------------------------------------------------------------------

const wordSegmenter = new Intl.Segmenter('th', { granularity: 'word' });
const graphemeSegmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
const isBlank = (s: string) => s.trim() === '';

/**
 * Wrap text to a maximum measured width. Thai has no spaces, so we segment into Thai WORDS first
 * (Intl.Segmenter) and only fall back to GRAPHEME-cluster breaking for a single word wider than the
 * column — never splitting a base character from its combining vowel/tone marks. Pure and testable:
 * `measure` returns the rendered width of a candidate string.
 */
export function wrapText(text: string, max: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let current = '';
    const commit = () => {
      lines.push(current.replace(/\s+$/, ''));
      current = '';
    };
    const addWord = (word: string) => {
      if (current === '' && isBlank(word)) return; // drop leading whitespace on a fresh line
      if (measure((current + word).replace(/\s+$/, '')) <= max) {
        current += word;
        return;
      }
      if (current !== '') commit();
      if (isBlank(word)) return;
      if (measure(word) <= max) {
        current = word;
        return;
      }
      // A single token wider than the column (typical long unspaced Thai): break by grapheme
      // clusters so tone/vowel marks stay attached to their base character.
      let chunk = '';
      for (const g of graphemeSegmenter.segment(word)) {
        const cluster = g.segment;
        if (chunk !== '' && measure(chunk + cluster) > max) {
          lines.push(chunk);
          chunk = '';
        }
        chunk += cluster;
      }
      current = chunk;
    };
    for (const seg of wordSegmenter.segment(paragraph)) addWord(seg.segment);
    if (current !== '') commit();
  }
  return lines.length ? lines : [''];
}

/**
 * Fit a single-line value (typically an exact money amount) into `maxWidth`: shrink the font from
 * `baseSize` down to `minSize`, and if it STILL overflows (e.g. a 40-digit satang amount) wrap it —
 * at that min size — into a few grapheme-safe lines. Digits are never altered, only laid out. Pure
 * and testable: `measure(text, size)` returns the rendered width.
 */
export function fitCellLines(
  text: string,
  maxWidth: number,
  measure: (s: string, size: number) => number,
  baseSize = 9.5,
  minSize = 6.5,
): { lines: string[]; size: number } {
  let size = baseSize;
  while (size > minSize && measure(text, size) > maxWidth) size -= 0.5;
  if (measure(text, size) <= maxWidth) return { lines: [text], size };
  return { lines: wrapText(text, maxWidth, (s) => measure(s, size)), size };
}

// -------------------------------------------------------------------------------------------------
// CSV
// -------------------------------------------------------------------------------------------------

const CRLF = '\r\n';
const money = (cell: MoneyCell) => (cell ? decimalMinor(cell.minor) : UNAVAILABLE);
const count = (cell: CountCell) => (cell === null ? UNAVAILABLE : String(cell));

/**
 * Full CSV report: UTF-8 BOM, CRLF line endings, RFC 4180 quoting and formula neutralisation on
 * every textual field. This is the machine-readable export (it may retain traceability fields such
 * as the request id); sections are separated by a blank line and each carries its own header.
 */
export function overviewReportCsv(input: OverviewReportInput): string {
  const model = buildOverviewReportModel(input);
  const rows: string[] = [];
  const push = (...cells: string[]) => rows.push(cells.join(','));

  push(csvText('รายงานภาพรวมรายได้ (Overview report)'));
  rows.push('');

  push(csvText('Field'), csvText('Value'));
  const meta: [string, string][] = [
    ['พาร์ทเนอร์ (Partner)', model.partnerName],
    ['ช่วงรายงาน (Range)', `${model.fromLabel} – ${model.inclusiveEndLabel}`],
    [
      'ช่วงข้อมูล ISO (Range ISO, end exclusive)',
      `${model.rangeIso.from} / ${model.rangeIso.toExclusive}`,
    ],
    ['แบรนด์ (Brand)', model.brandLabel],
    ['สถานะข้อมูล (Data state)', model.dataState],
    ['ความครอบคลุม (Coverage)', model.coverageStatus],
    ['ข้อมูล ณ (Data through)', model.dataThrough ?? UNAVAILABLE],
    ['ต้นทางสร้างเมื่อ (Source generated)', model.generatedAt],
    ['รหัสคำขอ (Request id)', model.requestId],
  ];
  for (const [label, value] of meta) push(csvText(label), csvText(value));
  rows.push('');

  push(csvText('Summary'), csvText('Amount (THB)'));
  for (const item of model.summary) push(csvText(item.label), money(item.amount));
  for (const item of model.counts) push(csvText(item.label), count(item.count));
  rows.push('');

  push(csvText('Daily commission (date)'), csvText('Commission (THB)'), csvText('Sales (THB)'));
  if (model.daily.length)
    for (const day of model.daily)
      push(csvText(day.date), decimalMinor(day.minor), money(day.sales));
  else push(csvText(UNAVAILABLE_TH), UNAVAILABLE, UNAVAILABLE);
  rows.push('');

  push(csvText('Daily sales by platform (date)'), csvText('Platform'), csvText('Sales (THB)'));
  const platformDays = model.daily.filter(
    (day): day is typeof day & { platforms: NonNullable<typeof day.platforms> } =>
      Boolean(day.platforms && day.platforms.length),
  );
  if (platformDays.length)
    for (const day of platformDays)
      for (const entry of day.platforms)
        push(csvText(day.date), csvText(PLATFORM_LABEL[entry.platform]), decimalMinor(entry.minor));
  else push(csvText(UNAVAILABLE_TH), UNAVAILABLE, UNAVAILABLE);
  rows.push('');

  push(csvText('Sales by brand'), csvText('Sales (THB)'));
  if (model.brands) for (const b of model.brands) push(csvText(b.label), decimalMinor(b.minor));
  else push(csvText(UNAVAILABLE_TH), UNAVAILABLE);
  rows.push('');

  push(csvText('Channel'), csvText('Amount (THB)'), csvText('Rate (ppm)'), csvText('Rate (%)'));
  if (model.channels)
    for (const c of model.channels)
      push(
        csvText(c.label),
        decimalMinor(c.minor),
        c.ratePpm === null ? UNAVAILABLE : String(c.ratePpm),
        c.ratePpm === null ? UNAVAILABLE : ratePercent(c.ratePpm),
      );
  else push(csvText(UNAVAILABLE_TH), UNAVAILABLE, UNAVAILABLE, UNAVAILABLE);
  rows.push('');

  push(
    csvText('Top clips (title)'),
    csvText('Brand'),
    csvText('Published'),
    csvText('Commission (THB)'),
  );
  if (model.topClips.length)
    for (const clip of model.topClips)
      push(
        csvText(clip.title),
        csvText(clip.brand),
        csvText(clip.publishedAt),
        clip.earned
          ? decimalMinor(clip.earned.minor)
          : csvText(clip.unavailableReason ?? UNAVAILABLE),
      );
  else push(csvText(UNAVAILABLE_TH), '', '', UNAVAILABLE);
  rows.push('');

  const notes = [model.statusNote, model.estimatedNote, model.unassignedNote].filter(
    (n): n is string => Boolean(n),
  );
  if (notes.length) {
    push(csvText('Notes'));
    for (const note of notes) push(csvText(note));
  }

  return '﻿' + rows.join(CRLF) + CRLF;
}

// -------------------------------------------------------------------------------------------------
// PDF
// -------------------------------------------------------------------------------------------------

/**
 * Clean, professional multi-page A4 PDF: a branded Labs D header carried on every page, a clear
 * report title, human-readable Thai dates, concise Thai labels with right-aligned exact money, and
 * "หน้า X / Y" page numbering. Tables repeat their column headers on continued pages and never
 * orphan a heading or a lone row. pdf-lib + fontkit and the font bytes are all loaded on demand so
 * the CSV path never pays for the embedded font.
 */
export async function overviewReportPdf(input: OverviewReportInput): Promise<Uint8Array> {
  const model = buildOverviewReportModel(input);
  const [{ PDFDocument }, { pdfColors, pdfDocumentLayout, embedDocumentFonts }] = await Promise.all(
    [import('pdf-lib'), import('@/shared/documents/pdf-theme')],
  );
  const doc = await PDFDocument.create();
  const { body, bold } = await embedDocumentFonts(doc);
  doc.setTitle('รายงานภาพรวมรายได้ | Labs D');
  doc.setAuthor('Labs D');
  doc.setSubject(`${model.partnerName} · ${model.fromLabel} – ${model.inclusiveEndLabel}`);

  const {
    width: A4W,
    height: A4H,
    margin,
    top: topMargin,
    bottom: contentBottom,
  } = pdfDocumentLayout;
  const contentWidth = A4W - margin * 2;

  const { ink, muted, rule, surface } = pdfColors;

  const width = (text: string, font: typeof body, size: number) =>
    font.widthOfTextAtSize(text, size);
  const wrap = (text: string, font: typeof body, size: number, max: number) =>
    wrapText(text, max, (s) => width(s, font, size));
  // Largest size ≤ base that fits `max` (down to `min`), so a very long valid number (up to a
  // 40-digit satang minor) shrinks to stay inside its column instead of crossing into the label.
  const fitSize = (text: string, font: typeof body, max: number, base: number, min: number) => {
    let size = base;
    while (size > min && width(text, font, size) > max) size -= 0.5;
    return size;
  };

  let page = doc.addPage([A4W, A4H]);
  let y = A4H;

  // Same optical title alignment and margins as the approved payment voucher.
  const drawRunningHeader = () => {
    const topY = A4H - topMargin;
    page.drawText('Labs D', {
      x: margin,
      y: topY + pdfDocumentLayout.latinTitleLift - 22,
      size: 22,
      font: bold,
      color: ink,
    });
    page.drawText('PARTNER', { x: margin, y: topY - 37, size: 8, font: body, color: muted });
    const title = 'รายงานรายได้';
    const originalX = margin + contentWidth * 0.56;
    const headerX =
      originalX + Math.max(0, A4W - margin - originalX - width(title, bold, 20)) * 0.5;
    page.drawText(title, { x: headerX, y: topY - 20, size: 20, font: bold, color: ink });
    page.drawText('EARNINGS REPORT', {
      x: headerX,
      y: topY - 37,
      size: 8,
      font: body,
      color: muted,
    });
    y = topY - 72;
  };

  const newPage = () => {
    page = doc.addPage([A4W, A4H]);
    y = A4H;
    drawRunningHeader();
  };

  drawRunningHeader();

  const paragraph = (
    text: string,
    o: { font?: typeof body; size?: number; color?: typeof ink; gap?: number; x?: number } = {},
  ) => {
    const font = o.font ?? body;
    const size = o.size ?? 10;
    const lh = size * 1.5;
    const x = o.x ?? margin;
    for (const line of wrap(text, font, size, A4W - x - margin)) {
      if (y - lh < contentBottom) newPage();
      page.drawText(line, { x, y: y - size, size, font, color: o.color ?? ink });
      y -= lh;
    }
    if (o.gap) y -= o.gap;
  };

  // Plain document metadata rows, never a dashboard card.
  const metadataRows = (items: { label: string; value: string }[]) => {
    const labelW = 96;
    for (const item of items) {
      const lines = wrap(item.value, body, 9.5, contentWidth - labelW);
      for (let i = 0; i < lines.length; i++) {
        if (y - 16 < contentBottom) newPage();
        if (i === 0)
          page.drawText(item.label, { x: margin, y: y - 9.5, size: 9.5, font: bold, color: muted });
        page.drawText(lines[i], {
          x: margin + labelW,
          y: y - 9.5,
          size: 9.5,
          font: body,
          color: ink,
        });
        y -= 16;
      }
      y -= 8;
    }
  };

  const sectionHeading = (title: string) => {
    y -= 12;
    page.drawText(title, { x: margin, y: y - 11, size: 11, font: bold, color: ink });
    y -= 30;
  };

  // Compact label/amount summary, using the voucher's fine rules and right-aligned amounts.
  const summaryBlock = (title: string, items: { label: string; value: string }[]) => {
    if (y - 78 < contentBottom) newPage();
    sectionHeading(title);
    const valueW = 180;
    for (const item of items) {
      const labels = wrap(item.label, body, 9.5, contentWidth - valueW - 16);
      const valueSize = fitSize(item.value, bold, valueW, 11, 8);
      const values = wrap(item.value, bold, valueSize, valueW);
      const count = Math.max(labels.length, values.length);
      for (let i = 0; i < count; i++) {
        if (y - 20 < contentBottom) {
          newPage();
          sectionHeading(title + ' (ต่อ)');
        }
        if (labels[i])
          page.drawText(labels[i], { x: margin, y: y - 10, size: 9.5, font: body, color: ink });
        if (values[i])
          page.drawText(values[i], {
            x: A4W - margin - width(values[i], bold, valueSize),
            y: y - valueSize,
            size: valueSize,
            font: bold,
            color: ink,
          });
        y -= 17;
      }
      y -= 5;
      page.drawLine({
        start: { x: margin, y },
        end: { x: A4W - margin, y },
        thickness: 0.4,
        color: rule,
      });
      y -= 5;
    }
  };

  type Col = { header: string; width: number; align?: 'right' };
  const tableBlock = (title: string, cols: Col[], data: string[][]) => {
    const size = 9.5;
    const lh = size * 1.45;
    const totalW = cols.reduce((s, c) => s + c.width, 0);
    const drawColHeader = () => {
      const h = lh + 3;
      page.drawLine({
        start: { x: margin, y: y + 2 },
        end: { x: margin + totalW, y: y + 2 },
        thickness: 0.4,
        color: rule,
      });
      let x = margin;
      for (const c of cols) {
        const tx = c.align === 'right' ? x + c.width - 6 - width(c.header, bold, size) : x + 4;
        page.drawText(c.header, { x: tx, y: y - size - 2, size, font: bold, color: ink });
        x += c.width;
      }
      y -= h;
      page.drawLine({
        start: { x: margin, y: y + 1 },
        end: { x: margin + totalW, y: y + 1 },
        thickness: 0.4,
        color: rule,
      });
    };
    // Left columns wrap to multiple lines; right (numeric) columns stay on a single adaptive-size
    // line so a large valid amount shrinks to fit rather than splitting mid-number.
    const layout = (row: string[]) =>
      cols.map((c, i) =>
        c.align === 'right'
          ? // Shrink to fit; if a very large valid amount still overflows, wrap it (min size) so it
            // never spills into the neighbouring column — the line-sliced renderer draws each line.
            fitCellLines(row[i], c.width - 8, (s, sz) => width(s, body, sz), size, 6.5)
          : { lines: wrap(row[i], body, size, c.width - 8), size },
      );
    // Keep the heading + column header + the first data LINE together (never a heading-only page).
    if (y - (42 + lh + 3 + lh + 4) < contentBottom) newPage();
    sectionHeading(title);
    drawColHeader();
    for (const row of data) {
      const cells = layout(row);
      const rowLines = Math.max(...cells.map((c) => c.lines.length), 1);
      // Draw the row LINE BY LINE, breaking to a fresh page (with the column header repeated) mid-row
      // so an oversized row is sliced across pages and no glyph is ever drawn below the footer.
      for (let li = 0; li < rowLines; li++) {
        if (y - lh < contentBottom) {
          newPage();
          sectionHeading(title + ' (ต่อ)');
          drawColHeader();
        }
        let x = margin;
        cols.forEach((c, i) => {
          const line = cells[i].lines[li];
          if (line !== undefined) {
            const cellSize = cells[i].size;
            const lx = c.align === 'right' ? x + c.width - 6 - width(line, body, cellSize) : x + 4;
            page.drawText(line, {
              x: lx,
              y: y - cellSize - 2,
              size: cellSize,
              font: body,
              color: ink,
            });
          }
          x += c.width;
          if (i < cols.length - 1)
            page.drawLine({
              start: { x, y },
              end: { x, y: y - lh - (li === rowLines - 1 ? 4 : 0) },
              thickness: pdfDocumentLayout.ruleWidth,
              color: rule,
            });
        });
        y -= lh;
      }
      y -= 4;
      page.drawLine({
        start: { x: margin, y: y + 3 },
        end: { x: margin + totalW, y: y + 3 },
        thickness: 0.4,
        color: rule,
      });
    }
  };

  // ---- Page 1 title block ----
  metadataRows([
    { label: 'พาร์ทเนอร์', value: model.partnerName },
    { label: 'ช่วงรายงาน', value: `${model.fromLabel} – ${model.inclusiveEndLabel}` },
    { label: 'แบรนด์', value: model.brandLabel },
    ...(model.dataThrough ? [{ label: 'ข้อมูล ณ', value: timestamp(model.dataThrough) }] : []),
  ]);

  // Status is shown ONLY when it changes the reading of the figures (partial/stale/unavailable).
  if (model.statusNote) {
    y -= 6;
    const size = 10;
    const lines = wrap('สถานะข้อมูล: ' + model.statusNote, body, size, contentWidth - 16);
    const boxH = lines.length * size * 1.45 + 10;
    if (y - boxH < contentBottom) newPage();
    page.drawRectangle({
      x: margin,
      y: y - boxH,
      width: contentWidth,
      height: boxH,
      color: surface,
      borderColor: rule,
      borderWidth: 0.4,
    });
    let ty = y - 8;
    for (const line of lines) {
      page.drawText(line, { x: margin + 8, y: ty - size, size, font: body, color: ink });
      ty -= size * 1.45;
    }
    y -= boxH;
  }

  // ---- Summary ----
  summaryBlock('สรุปยอด', [
    ...model.summary.map((s) => ({
      label: s.label,
      value: s.amount ? formatMinor(s.amount.minor) : UNAVAILABLE_TH,
    })),
    ...model.counts.map((c) => ({
      label: c.label,
      value: c.count === null ? UNAVAILABLE_TH : c.count.toLocaleString('en-US'),
    })),
  ]);

  // ---- Daily commission ----
  if (model.daily.length)
    tableBlock(
      'คอมมิชชันรายวัน',
      [
        { header: 'วันที่', width: contentWidth - 300 },
        { header: 'คอมมิชชัน (THB)', width: 150, align: 'right' },
        { header: 'ยอดขาย (THB)', width: 150, align: 'right' },
      ],
      model.daily.map((d) => [
        dateLabel(d.date + 'T00:00:00+07:00'),
        formatMinor(d.minor),
        // Unknown daily sales prints the explicit Thai unavailable token, never a fabricated 0.
        d.sales ? formatMinor(d.sales.minor) : UNAVAILABLE_TH,
      ]),
    );

  // ---- Daily sales by platform (only days that carry an authoritative breakdown) ----
  const dailyPlatformRows = model.daily.flatMap((d) =>
    (d.platforms ?? []).map((entry) => [
      dateLabel(d.date + 'T00:00:00+07:00'),
      PLATFORM_LABEL[entry.platform],
      formatMinor(entry.minor),
    ]),
  );
  if (dailyPlatformRows.length)
    tableBlock(
      'ยอดขายรายวันแยกตามช่องทาง',
      [
        { header: 'วันที่', width: contentWidth - 300 },
        { header: 'ช่องทาง', width: 150 },
        { header: 'ยอดขาย (THB)', width: 150, align: 'right' },
      ],
      dailyPlatformRows,
    );

  // ---- Sales by brand ----
  if (model.brands && model.brands.length)
    tableBlock(
      'ยอดขายแยกตามแบรนด์',
      [
        { header: 'แบรนด์', width: contentWidth - 190 },
        { header: 'ยอดขาย (THB)', width: 190, align: 'right' },
      ],
      model.brands.map((b) => [b.label, formatMinor(b.minor)]),
    );

  // ---- Channel breakdown (drop an all-zero "other" row to reduce clutter) ----
  if (model.channels) {
    const channelRows = model.channels.filter((c) => c.key !== 'other' || BigInt(c.minor) !== 0n);
    tableBlock(
      'สัดส่วนตามช่องทาง',
      [
        { header: 'ช่องทาง', width: contentWidth - 300 },
        { header: 'ยอด (THB)', width: 160, align: 'right' },
        { header: 'อัตรา', width: 140, align: 'right' },
      ],
      channelRows.map((c) => [
        c.label,
        formatMinor(c.minor),
        c.ratePpm === null ? '—' : ratePercent(c.ratePpm),
      ]),
    );
  }

  // ---- Top clips ----
  if (model.topClips.length)
    tableBlock(
      'คลิปยอดนิยม',
      [
        { header: 'คลิป', width: contentWidth - 210 },
        { header: 'แบรนด์', width: 110 },
        { header: 'คอมมิชชัน (THB)', width: 100, align: 'right' },
      ],
      model.topClips.map((clip) => [
        clip.title,
        clip.brand,
        clip.earned ? formatMinor(clip.earned.minor) : UNAVAILABLE_TH,
      ]),
    );

  // ---- Notes (only meaningful ones; no generic invoice disclaimer) ----
  const notes = [model.estimatedNote, model.unassignedNote].filter((n): n is string => Boolean(n));
  if (notes.length) {
    y -= 10;
    for (const note of notes) paragraph('• ' + note, { size: 9.5, color: muted });
  }

  // Footer page numbers, stamped after the full page count is known so "Y" is correct.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `หน้า ${i + 1} / ${pages.length}`;
    const size = 7.5;
    p.drawLine({
      start: { x: margin, y: 59 },
      end: { x: A4W - margin, y: 59 },
      thickness: 0.4,
      color: rule,
    });
    p.drawText('Labs D · Partner report', {
      x: margin,
      y: 42,
      size: 7.5,
      font: body,
      color: muted,
    });
    p.drawText(label, {
      x: A4W - margin - body.widthOfTextAtSize(label, size),
      y: 42,
      size,
      font: body,
      color: muted,
    });
  });

  return doc.save();
}

// -------------------------------------------------------------------------------------------------
// Download orchestration
// -------------------------------------------------------------------------------------------------

const aborted = () => new DOMException('Export cancelled', 'AbortError');

const download = (data: BlobPart, type: string, filename: string) => {
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
    // Revoke after the click has been dispatched so the download is not cancelled.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

/**
 * Entry point the UI calls on explicit format selection. Validates the snapshot, generates the
 * chosen format from the loaded scope only, and triggers a browser Blob download with the correct
 * MIME type and extension.
 *
 * The optional AbortSignal (agreed with the UI) lets a scope change / unmount cancel the work: it
 * is checked before the expensive generation and again just before the Blob anchor click. Throws on
 * an invalid/mismatched scope or on abort so the caller can surface it.
 */
export async function downloadOverviewReport(
  input: OverviewReportInput,
  format: 'csv' | 'pdf',
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw aborted();
  const base = reportBaseFilename(input);
  if (format === 'csv') {
    const csv = overviewReportCsv(input);
    if (signal?.aborted) throw aborted();
    download(csv, 'text/csv;charset=utf-8', `${base}.csv`);
    return;
  }
  const bytes = await overviewReportPdf(input);
  if (signal?.aborted) throw aborted();
  // A Uint8Array is a valid BlobPart at runtime; the cast satisfies the stricter lib typing that
  // distinguishes ArrayBuffer from the generic ArrayBufferLike returned by pdf-lib's save().
  download(bytes as unknown as BlobPart, 'application/pdf', `${base}.pdf`);
}
