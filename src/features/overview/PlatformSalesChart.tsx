import type { OverviewValue } from '@/contracts/overview';
import { BarChart } from '@/shared/charts/BarChart';
import { platformSalesItems } from './platform-sales';

export function PlatformSalesChart({ earnings }: { earnings: OverviewValue['earnings'] }) {
  const items = platformSalesItems(earnings);
  if (items === null) return null;
  const platforms = items
    .filter((item) => item.label !== 'ยังไม่ระบุแพลตฟอร์ม' && BigInt(item.value.minor) !== 0n)
    .map((item) => ({
      ...item,
      label: item.label === 'Webmarketplace' ? 'LabsD Online' : item.label,
    }));
  return platforms.length > 0 ? <BarChart items={platforms} /> : null;
}
