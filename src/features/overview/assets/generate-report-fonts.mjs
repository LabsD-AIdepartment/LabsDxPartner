// Regenerates report-fonts.ts by base64-embedding the self-hosted Sarabun static TTFs.
// Run from the repository root with the pinned Node 24 runtime:
//   /opt/homebrew/opt/node@24/bin/node src/features/overview/assets/generate-report-fonts.mjs
// The .ttf files stay in the repository as the licensed source of truth (see OFL.txt, PROVENANCE.md);
// this generated module lets the browser export chunk and the vitest (jsdom/node) tests load the
// exact same bytes without a network fetch or bundler asset loader.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const encode = (name) => readFileSync(resolve(dir, name)).toString('base64');
const regular = encode('Sarabun-Regular.ttf');
const semiBold = encode('Sarabun-SemiBold.ttf');

const source =
  '// GENERATED FILE — do not edit by hand. Regenerate with ./generate-report-fonts.mjs.\n' +
  '// Source: self-hosted Sarabun static TTF (SIL OFL 1.1). See ./Sarabun-Regular.ttf,\n' +
  '// ./Sarabun-SemiBold.ttf, ./OFL.txt and ./PROVENANCE.md.\n' +
  '// Sarabun covers Thai (incl. tone marks + the baht sign U+0E3F) and full Latin/digits/\n' +
  '// punctuation, so one embedded family renders the mixed Thai/English report without fallback.\n' +
  '/* eslint-disable */\n' +
  'export const sarabunRegularBase64 =\n  ' +
  JSON.stringify(regular) +
  ';\n' +
  'export const sarabunSemiBoldBase64 =\n  ' +
  JSON.stringify(semiBold) +
  ';\n';

const out = resolve(dir, 'report-fonts.ts');
writeFileSync(out, source);
console.log('wrote', out, statSync(out).size, 'bytes');
