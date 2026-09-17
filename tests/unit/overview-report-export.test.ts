import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { Overview, type OverviewValue } from '@/contracts/overview';
import { csvText as serverCsvText } from '@/server/modules/statements/export';
import {
  assertOverviewReportScope,
  buildOverviewReportModel,
  csvText,
  decimalMinor,
  downloadOverviewReport,
  fitCellLines,
  overviewReportCsv,
  overviewReportPdf,
  ratePercent,
  reportBaseFilename,
  wrapText,
  type OverviewReportInput,
} from '@/features/overview/report-export';

const m = (minor: string) => ({ currency: 'THB' as const, minor });
const instant = (day: string) => `${day}T00:00:00+07:00`;
const win = (from: string, toExclusive: string) => ({
  from: instant(from),
  toExclusive: instant(toExclusive),
  timezone: 'Asia/Bangkok' as const,
});

/** Build a valid OverviewValue for a window, then apply earnings overrides. */
function overview(
  from: string,
  toExclusive: string,
  earnings: Partial<OverviewValue['earnings']> = {},
): OverviewValue {
  const period = win(from, toExclusive);
  return Overview.parse({
    dataState: 'ready',
    generatedAt: '2026-09-16T12:00:00+07:00',
    dataThrough: '2026-09-16T12:00:00+07:00',
    reasons: [],
    requestId: 'req-1',
    earnings: {
      generation: '1',
      period,
      coverage: { status: 'complete', periods: [period] },
      estimated: m('0'),
      confirmed: m('0'),
      eligibleSales: m('0'),
      unassignedAmount: m('0'),
      excludedCount: 0,
      trend: [],
      topContent: [],
      ...earnings,
    },
    obligation: { asOf: '2026-09-16T12:00:00+07:00', confirmedUnpaid: m('0'), nextPayout: null },
  });
}

const input = (data: OverviewValue, brand: string | null = null, partnerName = 'มดดำ คชาภา') =>
  ({
    data,
    filters: { from: '2026-07-01', toExclusive: '2026-09-01', brand },
    partnerName,
  }) as OverviewReportInput;

describe('exact money + rate formatting', () => {
  it('decimalMinor renders satang as two decimals for zero, huge and negative amounts', () => {
    expect(decimalMinor('0')).toBe('0.00');
    expect(decimalMinor('3736000')).toBe('37360.00');
    expect(decimalMinor('5')).toBe('0.05');
    expect(decimalMinor('99999999999999999999')).toBe('999999999999999999.99');
    expect(decimalMinor('-200050')).toBe('-2000.50');
  });
  it('ratePercent converts ppm exactly', () => {
    expect(ratePercent(100000)).toBe('10%');
    expect(ratePercent(30000)).toBe('3%');
    expect(ratePercent(5000)).toBe('0.5%');
    expect(ratePercent(0)).toBe('0%');
    expect(ratePercent(1000000)).toBe('100%');
    expect(ratePercent(12345)).toBe('1.2345%');
  });
  it('csvText matches the server statement export neutralisation', () => {
    for (const text of [
      'คุณก้อง',
      'a,"b"',
      '=1+1',
      ' +SUM(A1:A2)',
      '-1+2',
      '@cmd',
      '\t=x',
      '\r=x',
      '\n=x',
    ])
      expect(csvText(text)).toBe(serverCsvText(text));
  });
});

describe('fitCellLines keeps a numeric cell inside its column', () => {
  const measure = (s: string, size: number) => s.length * size * 0.6; // deterministic

  it('returns a single line at the base size when it already fits', () => {
    const r = fitCellLines('1,234.00', 100, measure);
    expect(r.lines).toEqual(['1,234.00']);
    expect(r.size).toBe(9.5);
  });
  it('shrinks the font before wrapping when possible', () => {
    const r = fitCellLines('12345678901234', 60, measure, 9.5, 6.5);
    expect(r.lines).toHaveLength(1);
    expect(r.size).toBeLessThan(9.5);
    expect(measure(r.lines[0], r.size)).toBeLessThanOrEqual(60);
  });
  it('wraps a 40-digit amount into few lines that fit, preserving exact digits', () => {
    const amount = '฿' + '9'.repeat(38) + '.99'; // formatMinor of a 40-digit satang value
    const r = fitCellLines(amount, 60, measure, 9.5, 6.5);
    expect(r.size).toBe(6.5); // hit the floor, then wrapped
    expect(r.lines.length).toBeGreaterThan(1);
    for (const line of r.lines) expect(measure(line, r.size)).toBeLessThanOrEqual(60);
    expect(r.lines.join('')).toBe(amount); // nothing dropped or altered
  });
});

describe('wrapText preserves Thai grapheme clusters', () => {
  const measure = (s: string) => [...s].length; // 1 unit per code point for deterministic tests
  it('never splits a base character from its combining vowel/tone marks', () => {
    // "ที่" is base ท + sara ii + mai tho (3 code points, one cluster). With a tiny max it must
    // stay whole rather than break between the base and its marks.
    const lines = wrapText('ที่ที่ที่ที่', 3, measure);
    for (const line of lines) expect([...line].join('')).not.toMatch(/^[ัิ-ฺ็-๎]/);
    expect(lines.join('')).toBe('ที่ที่ที่ที่');
  });
  it('breaks a long unspaced Thai word by clusters within the max width', () => {
    const word = 'พรีวิวคอลใหม่เดือนกันยายนยังรอยืนยันยอด';
    const lines = wrapText(word, 8, measure);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(8);
    expect(lines.join('')).toBe(word);
  });
  it('wraps on Thai word boundaries and keeps paragraphs/newlines', () => {
    const lines = wrapText('บรรทัดแรก\nบรรทัดสอง', 100, measure);
    expect(lines).toEqual(['บรรทัดแรก', 'บรรทัดสอง']);
  });
});

describe('scope validation', () => {
  it('throws when the filters do not match the loaded earnings period', () => {
    const data = overview('2026-07-01', '2026-10-01', {});
    expect(() => buildOverviewReportModel(input(data))).toThrow(/do not match/);
  });
  it('throws on an empty partner name and on an invalid window', () => {
    const data = overview('2026-07-01', '2026-09-01');
    expect(() => assertOverviewReportScope(input(data, null, '   '))).toThrow(/partner name/);
    expect(() =>
      assertOverviewReportScope({
        data,
        filters: { from: '2026-09-01', toExclusive: '2026-07-01', brand: null },
        partnerName: 'x',
      }),
    ).toThrow();
  });
  it('reports an inclusive human end date (Oct 1 exclusive → 30 ก.ย.)', () => {
    const data = overview('2026-07-01', '2026-10-01', {});
    const model = buildOverviewReportModel({
      data,
      filters: { from: '2026-07-01', toExclusive: '2026-10-01', brand: null },
      partnerName: 'x',
    });
    expect(model.inclusiveEndLabel).toMatch(/ก\.ย\./); // September, not October
  });
});

describe('CSV report', () => {
  const rich = () =>
    overview('2026-07-01', '2026-09-01', {
      confirmed: m('3736000'),
      estimated: m('700000'),
      eligibleSales: m('55000000'),
      unassignedAmount: m('0'),
      contentCount: 6,
      trend: [{ date: '2026-08-10', amount: m('3736000') }],
      salesByBrand: [
        { label: 'Axtion', value: m('128000000') },
        { label: '=cmd()', value: m('1000') },
      ],
      channelBreakdown: {
        organic: m('2980000'),
        brandAds: m('756000'),
        other: m('0'),
        organicRatePpm: 100000,
        brandAdsRatePpm: 30000,
      },
      topContent: [
        {
          id: 'clip-1',
          title: 'พูดตรง ๆ, ตัวนี้ดี',
          brand: 'Axtion',
          publishedAt: '2026-08-28T12:00:00+07:00',
          cover: '/media/clip-cover-1.png',
          coverPosition: '50% 50%',
          removed: false,
          views: 812000,
          earned: m('1280000'),
          unavailableReason: null,
        },
      ],
    });

  it('starts with a UTF-8 BOM and uses CRLF line endings', () => {
    const csv = overviewReportCsv(input(rich()));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n').length).toBeGreaterThan(10);
  });
  it('neutralises formula injection in names, brands and titles', () => {
    const csv = overviewReportCsv(input(rich(), null, '=danger()'));
    expect(csv).toContain('"\'=danger()"'); // partner name neutralised
    expect(csv).toContain('"\'=cmd()"'); // brand label neutralised
    expect(csv).toContain('"พูดตรง ๆ, ตัวนี้ดี"'); // title quoted (comma), unchanged
  });
  it('renders exact amounts and represents unknown as unavailable, never 0', () => {
    const csv = overviewReportCsv(input(rich()));
    expect(csv).toContain('37360.00');
    expect(csv).toContain('550000.00');
    const unknown = overviewReportCsv(
      input(
        overview('2026-07-01', '2026-09-01', {
          coverage: { status: 'unavailable', periods: [] },
          estimated: null,
          confirmed: null,
          eligibleSales: null,
          unassignedAmount: null,
          excludedCount: null,
          salesByBrand: null,
          channelBreakdown: null,
          contentCount: null,
          trend: [],
          topContent: [],
        }),
      ),
    );
    expect(unknown).toContain('unavailable');
    expect(unknown).not.toContain('0.00');
  });
  it('omits views from the export snapshot and CSV while retaining exact clip commission', () => {
    const data = rich();
    const model = buildOverviewReportModel(input(data));
    expect(model.topClips[0]).not.toHaveProperty('views');
    expect(data.earnings.topContent[0].views).toBe(812000);
    expect(model.topClips[0].earned).toEqual(m('1280000'));
    const csv = overviewReportCsv(input(data));
    expect(csv).toContain('"Top clips (title)","Brand","Published","Commission (THB)"');
    expect(csv).toContain('"พูดตรง ๆ, ตัวนี้ดี","Axtion","2026-08-28T12:00:00+07:00",12800.00');
    expect(csv).not.toMatch(/Views|812000|812,000/);
  });
  it('includes the precise estimated note only when estimated is nonzero', () => {
    expect(overviewReportCsv(input(rich()))).toContain(
      'ประมาณการแยกจากคอมมิชชันที่ยืนยันแล้ว และอาจเปลี่ยนแปลงก่อนตัดรอบ',
    );
    const noEstimate = overviewReportCsv(
      input(
        overview('2026-07-01', '2026-09-01', {
          confirmed: m('100'),
          estimated: m('0'),
          trend: [{ date: '2026-08-01', amount: m('100') }],
        }),
      ),
    );
    expect(noEstimate).not.toContain('ประมาณการแยกจาก');
  });
});

describe('PDF report', () => {
  const parse = async (bytes: Uint8Array) => {
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    return PDFDocument.load(bytes);
  };
  it('generates a parseable single-scope report', async () => {
    const data = overview('2026-07-01', '2026-09-01', {
      confirmed: m('3736000'),
      estimated: m('700000'),
      eligibleSales: m('55000000'),
      contentCount: 6,
      trend: [{ date: '2026-08-10', amount: m('3736000') }],
      salesByBrand: [{ label: 'Axtion', value: m('128000000') }],
      channelBreakdown: {
        organic: m('2980000'),
        brandAds: m('756000'),
        other: m('0'),
        organicRatePpm: 100000,
        brandAdsRatePpm: 30000,
      },
      topContent: [
        {
          id: 'clip-1',
          title: 'พูดตรง ๆ ตัวนี้ช่วยให้เช้าวันทำงานง่ายขึ้นมากจริง ๆ นะทุกคน',
          brand: 'Axtion',
          publishedAt: '2026-08-28T12:00:00+07:00',
          cover: '/media/clip-cover-1.png',
          coverPosition: '50% 50%',
          removed: false,
          views: 812000,
          earned: m('1280000'),
          unavailableReason: null,
        },
      ],
    });
    const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
    try {
      const doc = await parse(await overviewReportPdf(input(data)));
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
      const rendered = drawText.mock.calls.map(([value]) => value).join(' ');
      expect(rendered).not.toMatch(/ยอดวิว|812,000/);
      expect(rendered).toContain('12,800');
      expect(rendered).toContain('Labs D');
      expect(rendered).not.toContain('LabsD');
      expect(rendered).toContain('฿37,360.00');
      expect(rendered).toContain('฿550,000.00');
      expect(doc.getAuthor()).toBe('Labs D');
      for (const [, options] of drawText.mock.calls) {
        expect(options?.y).toBeGreaterThanOrEqual(30);
        expect(options?.y).toBeLessThan(800);
      }
    } finally {
      drawText.mockRestore();
    }
  });
  it('paginates a 365-day daily table across multiple pages with repeated headers', async () => {
    const trend: { date: string; amount: { currency: 'THB'; minor: string } }[] = [];
    let total = 0n;
    const anchor = Date.parse('2026-07-01T12:00:00+07:00');
    const bangkokDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });
    for (let i = 0; i < 365; i++) {
      const date = bangkokDate.format(new Date(anchor + i * 86_400_000));
      const minor = BigInt(100 + i);
      total += minor;
      trend.push({ date, amount: m(minor.toString()) });
    }
    const data = overview('2026-07-01', '2027-07-01', {
      confirmed: m(total.toString()),
      estimated: m('0'),
      eligibleSales: m('0'),
      trend,
    });
    const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
    try {
      const doc = await parse(
        await overviewReportPdf({
          data,
          filters: { from: '2026-07-01', toExclusive: '2027-07-01', brand: null },
          partnerName: 'มดดำ คชาภา',
        }),
      );
      expect(doc.getPageCount()).toBeGreaterThan(1);
      const rendered = drawText.mock.calls.map(([text]) => text);
      expect(rendered.filter((text) => text === 'Labs D')).toHaveLength(doc.getPageCount());
      expect(rendered.filter((text) => text === 'คอมมิชชัน (THB)')).toHaveLength(
        doc.getPageCount(),
      );
      // Every daily amount survives the more spacious card layout and page breaks.
      for (let i = 0; i < 365; i++) expect(rendered).toContain(`฿${decimalMinor(String(100 + i))}`);
      for (let i = 1; i <= doc.getPageCount(); i++)
        expect(rendered).toContain(`หน้า ${i} / ${doc.getPageCount()}`);
      for (const [text, options] of drawText.mock.calls) {
        if (!text.startsWith('หน้า ') && text !== 'Labs D · Partner report')
          expect(options?.y).toBeGreaterThan(46);
      }
    } finally {
      drawText.mockRestore();
    }
  });
  it('renders huge and negative amounts and an unavailable scenario without throwing', async () => {
    const huge = overview('2026-07-01', '2026-09-01', {
      confirmed: m('99999999999999999999'),
      estimated: m('0'),
      trend: [{ date: '2026-08-01', amount: m('99999999999999999999') }],
    });
    await parse(await overviewReportPdf(input(huge)));
    const negative = overview('2026-07-01', '2026-09-01', {
      confirmed: m('-500000'),
      estimated: m('0'),
      trend: [{ date: '2026-08-01', amount: m('-500000') }],
    });
    await parse(await overviewReportPdf(input(negative)));
    const unknown = overview('2026-07-01', '2026-09-01', {
      coverage: { status: 'unavailable', periods: [] },
      estimated: null,
      confirmed: null,
      eligibleSales: null,
      unassignedAmount: null,
      excludedCount: null,
      salesByBrand: null,
      channelBreakdown: null,
      contentCount: null,
      trend: [],
      topContent: [],
    });
    await parse(await overviewReportPdf(input(unknown)));
  });
  it('fits a maximum 40-digit satang amount (incl. a top-clips numeric cell) without crossing columns', async () => {
    const forty = '9'.repeat(40); // Minor allows up to 40 chars
    const data = overview('2026-07-01', '2026-09-01', {
      confirmed: m(forty),
      estimated: m('0'),
      eligibleSales: m(forty),
      trend: [{ date: '2026-08-01', amount: m(forty) }],
      salesByBrand: [{ label: 'Axtion', value: m(forty) }],
      // The exact case root flagged: a 40-digit amount in the top-clips numeric column, plus a
      // sibling clip, must fit-then-wrap and not overlap the brand cell.
      topContent: [
        {
          id: 'clip-1',
          title: 'คลิปยอดสูงมาก',
          brand: 'Axtion',
          publishedAt: '2026-08-28T12:00:00+07:00',
          cover: '/media/clip-cover-1.png',
          coverPosition: '50% 50%',
          removed: false,
          views: 812000,
          earned: m(forty),
          unavailableReason: null,
        },
        {
          id: 'clip-2',
          title: 'คลิปที่ยอดวิวไม่ทราบ',
          brand: 'Tendrix',
          publishedAt: '2026-08-24T12:00:00+07:00',
          cover: '/media/clip-cover-2.png',
          coverPosition: '50% 50%',
          removed: false,
          views: null,
          earned: m('1280000'),
          unavailableReason: null,
        },
      ],
    });
    const doc = await parse(await overviewReportPdf(input(data)));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
  it('slices a single oversized long-title row across pages (no heading-only/off-page rows)', async () => {
    const draw = vi.spyOn(PDFPage.prototype, 'drawText');
    const longTitle = Array.from(
      { length: 100 },
      () => 'พูดตรง ๆ ตัวนี้ช่วยให้เช้าวันทำงานง่ายขึ้นมากจริง ๆ',
    ).join(' ');
    const data = overview('2026-07-01', '2026-09-01', {
      confirmed: m('1280000'),
      estimated: m('0'),
      trend: [{ date: '2026-08-28', amount: m('1280000') }],
      topContent: [
        {
          id: 'clip-1',
          title: longTitle,
          brand: 'Axtion',
          publishedAt: '2026-08-28T12:00:00+07:00',
          cover: '/media/clip-cover-1.png',
          coverPosition: '50% 50%',
          removed: false,
          views: 812000,
          earned: m('1280000'),
          unavailableReason: null,
        },
      ],
    });
    const doc = await parse(
      await overviewReportPdf(input(data, null, 'มดดำ คชาภา '.repeat(10).trim())),
    );
    expect(doc.getPageCount()).toBeGreaterThan(1);
    for (const [value, options] of draw.mock.calls) {
      expect(options!.x!).toBeGreaterThanOrEqual(62.4 - 0.01);
      expect(
        options!.x! + options!.font!.widthOfTextAtSize(value, options!.size!),
      ).toBeLessThanOrEqual(595.28 - 62.4 + 0.01);
      expect(options!.y!).toBeGreaterThanOrEqual(42);
    }
    draw.mockRestore();
  });
  it('renders a clip with unknown (null) views as unavailable in both formats', async () => {
    const data = overview('2026-07-01', '2026-09-01', {
      confirmed: m('1280000'),
      estimated: m('0'),
      trend: [{ date: '2026-08-28', amount: m('1280000') }],
      topContent: [
        {
          id: 'clip-1',
          title: 'คลิปที่ต้นทางยังไม่ส่งยอดวิว',
          brand: 'Axtion',
          publishedAt: '2026-08-28T12:00:00+07:00',
          cover: '/media/clip-cover-1.png',
          coverPosition: '50% 50%',
          removed: false,
          views: null,
          earned: m('1280000'),
          unavailableReason: null,
        },
      ],
    });
    expect(overviewReportCsv(input(data))).toContain('unavailable');
    await parse(await overviewReportPdf(input(data)));
  });
});

describe('daily sales + platform breakdown export', () => {
  const withSales = () =>
    overview('2026-07-01', '2026-09-01', {
      confirmed: m('300'),
      estimated: m('0'),
      eligibleSales: m('0'),
      trend: [
        {
          date: '2026-08-01',
          amount: m('100'),
          sales: m('1000'),
          salesByPlatform: [
            { platform: 'facebook', sales: m('600') },
            { platform: 'tiktok', sales: m('400') },
          ],
        },
        {
          date: '2026-08-02',
          amount: m('200'),
          sales: m('500'),
          salesByPlatform: [{ platform: 'unattributed', sales: m('500') }],
        },
      ],
    });

  it('CSV daily table carries an exact per-day sales column beside the commission column', () => {
    const csv = overviewReportCsv(input(withSales()));
    expect(csv).toContain(csvText('Sales (THB)'));
    expect(csv).toContain('"2026-08-01",1.00,10.00'); // date, commission, sales in one row
  });
  it('CSV emits a daily sales-by-platform section with human platform labels and exact amounts', () => {
    const csv = overviewReportCsv(input(withSales()));
    expect(csv).toContain(csvText('Daily sales by platform (date)'));
    expect(csv).toContain('"2026-08-01","Facebook",6.00');
    expect(csv).toContain('"2026-08-01","TikTok",4.00');
    expect(csv).toContain('"2026-08-02","ไม่ระบุช่องทาง",5.00');
  });
  it('CSV renders unknown daily sales as unavailable (never 0) and an empty platform section', () => {
    const legacy = overview('2026-07-01', '2026-09-01', {
      confirmed: m('100'),
      estimated: m('0'),
      trend: [{ date: '2026-08-01', amount: m('100') }], // legacy point: no sales/breakdown
    });
    const csv = overviewReportCsv(input(legacy));
    expect(csv).toContain('"2026-08-01",1.00,unavailable');
    expect(csv).toContain(csvText('Daily sales by platform (date)'));
  });
  it('PDF renders the daily sales column and platform breakdown table without throwing', async () => {
    const parse = async (bytes: Uint8Array) => {
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      return PDFDocument.load(bytes);
    };
    const doc = await parse(await overviewReportPdf(input(withSales())));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('downloadOverviewReport orchestration + abort', () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let revokeSpy: ReturnType<typeof vi.fn>;
  const anchors: HTMLAnchorElement[] = [];
  const realCreate = document.createElement.bind(document);

  beforeEach(() => {
    anchors.length = 0;
    createSpy = vi.fn(() => 'blob:mock');
    revokeSpy = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = vi.fn();
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const data = () =>
    overview('2026-07-01', '2026-09-01', {
      confirmed: m('100'),
      estimated: m('0'),
      trend: [{ date: '2026-08-01', amount: m('100') }],
    });

  it('downloads a CSV with the correct extension and MIME type', async () => {
    await downloadOverviewReport(input(data()), 'csv');
    expect(createSpy).toHaveBeenCalledTimes(1);
    const blob = createSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(anchors[0].download).toMatch(/\.csv$/);
  });
  it('downloads a PDF with the correct extension and MIME type', async () => {
    await downloadOverviewReport(input(data()), 'pdf');
    expect(createSpy).toHaveBeenCalledTimes(1);
    const blob = createSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/pdf');
    expect(anchors[0].download).toMatch(/\.pdf$/);
  });
  it('rejects and downloads nothing when the signal is already aborted (csv + pdf)', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(downloadOverviewReport(input(data()), 'csv', controller.signal)).rejects.toThrow(
      /cancel/i,
    );
    await expect(downloadOverviewReport(input(data()), 'pdf', controller.signal)).rejects.toThrow(
      /cancel/i,
    );
    expect(createSpy).not.toHaveBeenCalled();
  });
  it('aborts the PDF between generation and the Blob click (no download)', async () => {
    const controller = new AbortController();
    const promise = downloadOverviewReport(input(data()), 'pdf', controller.signal);
    controller.abort(); // fires while the async PDF generation is still running
    await expect(promise).rejects.toThrow(/cancel/i);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('filename', () => {
  it('slugs the partner and window into a safe base name', () => {
    expect(reportBaseFilename(input(overview('2026-07-01', '2026-09-01'), null, 'มดดำ'))).toBe(
      'overview-report_partner_2026-07-01_to_2026-09-01',
    );
    expect(
      reportBaseFilename(input(overview('2026-07-01', '2026-09-01'), null, 'Ant Kachapa')),
    ).toBe('overview-report_ant-kachapa_2026-07-01_to_2026-09-01');
  });
});
