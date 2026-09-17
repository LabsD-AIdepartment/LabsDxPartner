import { rgb, type PDFDocument, type PDFPage, type RGB } from 'pdf-lib';

/** Print palette corresponding to the web's Day theme; PDFs always use white paper. */
export const pdfColors = {
  ink: rgb(39 / 255, 41 / 255, 37 / 255),
  muted: rgb(95 / 255, 101 / 255, 88 / 255),
  accent: rgb(35 / 255, 113 / 255, 64 / 255),
  rule: rgb(228 / 255, 229 / 255, 223 / 255),
  surface: rgb(249 / 255, 249 / 255, 247 / 255),
  greenSurface: rgb(239 / 255, 246 / 255, 234 / 255),
};

/** Approved ruled-document layout, shared by vouchers and analytical reports. */
export const pdfDocumentLayout = {
  width: 595.28,
  height: 841.89,
  margin: 48 * 1.3,
  top: 48,
  bottom: 78,
  ruleWidth: 0.4,
  latinTitleLift: 3.14,
} as const;

/** Both renderers embed identical, offline, licensed web-family glyphs. */
export async function embedDocumentFonts(doc: PDFDocument) {
  const [fontkitModule, fonts] = await Promise.all([
    import('@pdf-lib/fontkit'),
    import('./assets/document-fonts'),
  ]);
  doc.registerFontkit(fontkitModule.default);
  const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const [body, bold] = await Promise.all([
    doc.embedFont(decode(fonts.documentRegularBase64), { subset: true }),
    doc.embedFont(decode(fonts.documentSemiBoldBase64), { subset: true }),
  ]);
  return { body, bold };
}

export function drawPdfCard(
  page: PDFPage,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius?: number;
    color?: RGB;
    borderColor?: RGB;
  },
) {
  const {
    x,
    y,
    width: w,
    height: h,
    color = pdfColors.surface,
    borderColor = pdfColors.rule,
  } = options;
  const r = Math.min(options.radius ?? 12, w / 2, h / 2);
  // SVG paths use a top-left origin; pdf-lib flips Y when painting them.
  page.drawSvgPath(
    `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`,
    {
      x,
      y: y + h,
      color,
      borderColor,
      borderWidth: 0.6,
    },
  );
}
