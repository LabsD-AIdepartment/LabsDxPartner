import type { PeriodCoverageValue } from '@/contracts/coverage';
import { DataState } from '@/shared/ui/DataState';
import { timestamp } from '@/shared/ui/format-date';

export function CoverageNotice({ coverage }: { coverage: PeriodCoverageValue }) {
  if (coverage.status !== 'partial') return null;
  return (
    <div>
      <DataState
        state="partial"
        message="ยอดนี้รวมเฉพาะช่วงที่เผยแพร่แล้ว ยังไม่ครบช่วงวันที่เลือก"
      />
      <details>
        <summary>ดูช่วงที่รวมในยอดนี้</summary>
        <ul>
          {coverage.periods.map((p) => (
            <li key={p.from}>
              {timestamp(p.from)} – ก่อน {timestamp(p.toExclusive)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
