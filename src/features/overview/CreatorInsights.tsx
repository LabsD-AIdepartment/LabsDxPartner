import { Sparkles } from 'lucide-react';
import { Money } from '@/shared/ui/Money';
import type { EarningsHighlight } from './earnings-highlights';
import styles from './overview.module.css';

export function CreatorInsights({ items }: { items: EarningsHighlight[] }) {
  return (
    <section className={styles.creatorInsights} aria-label="ไอเดียสำหรับคลิปถัดไป" lang="th">
      <h3>
        <Sparkles size={16} aria-hidden />
        ไอเดียสำหรับคลิปถัดไป
      </h3>
      <ul className={styles.insightList}>
        {items.map((item) => (
          <li key={item.id} className={styles.insightItem}>
            <p className={styles.insightLabel}>{item.label}</p>
            {item.subject && (
              <div className={styles.insightMetric}>
                <strong>{item.subject}</strong>
                {item.amount && <Money value={item.amount} />}
              </div>
            )}
            {item.description && <p className={styles.insightDescription}>{item.description}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
