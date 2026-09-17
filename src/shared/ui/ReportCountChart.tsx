import { formatExactDecimal } from '@/contracts/platform-metrics';
import { Text } from './Text';
import { dateLabel } from './format-date';
import styles from './report-count-chart.module.css';
type Period = { from: string; toExclusive: string };
/** Only plotting coordinates use Number. Unknown intervals break the line. */
export function ReportCountChart({
  period,
  series,
  label,
}: {
  period: Period;
  series: { period: Period; value: string | null }[];
  label: string;
}) {
  const max = series.reduce(
    (a, s) => (s.value !== null && BigInt(s.value) > a ? BigInt(s.value) : a),
    0n,
  );
  const groups: string[][] = [];
  series.forEach((s, i) => {
    if (s.value === null) {
      groups.push([]);
      return;
    }
    if (
      !groups.length ||
      (i > 0 && Date.parse(series[i - 1].period.toExclusive) !== Date.parse(s.period.from))
    )
      groups.push([]);
    const x =
      10 +
      (680 * (Date.parse(s.period.from) - Date.parse(period.from))) /
        (Date.parse(period.toExclusive) - Date.parse(period.from));
    const y = 130 - Number((BigInt(s.value) * 11000n) / (max || 1n)) / 100;
    groups.at(-1)!.push(`${x},${y}`);
  });
  if (series.length < 2 || !series.some((s) => s.value !== null)) return null;
  return (
    <section>
      <Text as="h3">{label}ตามช่วงรายงาน</Text>
      <Text tone="muted">
        {dateLabel(period.from)} – ก่อน {dateLabel(period.toExclusive)} · ค่าสูงสุด{' '}
        {formatExactDecimal(max.toString(), 0)}
      </Text>
      <svg
        viewBox="0 0 700 150"
        role="img"
        aria-label="แนวโน้มตามช่วงรายงาน รายละเอียดตัวเลขอยู่ด้านล่าง"
        className={styles.chart}
      >
        {groups
          .filter((g) => g.length)
          .map((g, i) => (
            <g key={i}>
              <polyline points={g.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />
              {g.map((point) => {
                const [cx, cy] = point.split(',');
                return <circle key={point} cx={cx} cy={cy} r="2" fill="currentColor" />;
              })}
            </g>
          ))}
      </svg>
    </section>
  );
}
