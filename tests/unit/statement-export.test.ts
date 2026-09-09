import { describe, it, expect } from 'vitest';
import { csvText } from '@/server/modules/statements/export';
describe('statement CSV text', () => {
  it('quotes separators and neutralizes formulas without changing normal Thai labels', () => {
    expect(csvText('คุณก้อง')).toBe('"คุณก้อง"');
    expect(csvText('a,"b"')).toBe('"a,""b"""');
    for (const text of ['=1+1', ' +SUM(A1:A2)', '-1+2', '@cmd', '\t=cmd', '\r=cmd', '\n=cmd'])
      expect(csvText(text)).toBe('"\'' + text + '"');
  });
});
