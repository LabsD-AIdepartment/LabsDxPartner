import { Text } from '@/shared/ui/Text';
import { Card } from '@/shared/ui/Card';
import { Money } from '@/shared/ui/Money';
import { DataState } from '@/shared/ui/DataState';
import { PartnerIdentity } from './PartnerIdentity';
import type { PartnerPresentation } from './EarningsSummary';
import styles from './overview.module.css';
/** Retain the card/image geometry without inventing a financial response or a chart series. */
export function UnavailableOverview({ partner }: { partner?: PartnerPresentation }) {
  return (
    <div className={styles.contentBands}>
      <div className={styles.grid}>
        <Card className={styles.earnings} aria-label="โปรไฟล์และคอมมิชชัน">
          <PartnerIdentity partner={partner} />
          <div className={styles.earningPane}>
            <Text as="h2" variant="cardTitle">
              คอมมิชชันของฉัน
            </Text>
            <Money value={null} className={styles.heroMoney} />
            <DataState state="unavailable" />
          </div>
        </Card>
        <Card className={styles.sales} title="Sales in motion">
          <Money value={null} className={styles.largeMoney} />
          <DataState state="unavailable" />
        </Card>
        <Card className={styles.payout} title="Your next payout">
          <Money value={null} className={styles.largeMoney} />
          <DataState state="unavailable" />
        </Card>
        <Card className={styles.trend} title="Every clip counts">
          <DataState state="unavailable" />
        </Card>
      </div>
      <div className={styles.lower}>
        <Card title="Small clips Real results">
          <DataState state="unavailable" />
        </Card>
        <Card title="Earnings Mix">
          <DataState state="unavailable" />
        </Card>
      </div>
    </div>
  );
}
