import type { OverviewValue } from '@/contracts/overview';
import type { MoneyValue } from '@/contracts/common';
import { platformSalesItems } from './platform-sales';
import { formatMinor } from '@/shared/ui/format-money';

/** Presentation subtotal only: never replaces the authoritative (possibly unknown) total. */
export function pendingEarningsDisplay(earnings: OverviewValue['earnings']): {
  amount: MoneyValue | null;
  partial: boolean;
} {
  if (earnings.estimated !== null) return { amount: earnings.estimated, partial: false };
  const known = (earnings.connectedAdEarnings ?? []).flatMap((entry) =>
    entry.amount === null ? [] : [entry.amount],
  );
  return {
    amount: known.length
      ? {
          currency: 'THB',
          minor: known.reduce((sum, amount) => sum + BigInt(amount.minor), 0n).toString(),
        }
      : null,
    partial: known.length > 0,
  };
}

/** Read-only ideas from the selected period. No invented growth rate or content classification. */
export function earningsHighlights(earnings: OverviewValue['earnings']): string[] {
  const highlights: string[] = [];
  const items = platformSalesItems(earnings);
  const ranked = items
    ?.filter((item) => item.label !== 'ยังไม่ระบุแพลตฟอร์ม' && BigInt(item.value.minor) > 0n)
    .sort((a, b) =>
      BigInt(a.value.minor) > BigInt(b.value.minor)
        ? -1
        : BigInt(a.value.minor) < BigInt(b.value.minor)
          ? 1
          : 0,
    );
  const leading = ranked?.[0];
  if (leading) {
    const label = leading.label === 'Webmarketplace' ? 'LabsD Online' : leading.label;
    const complete =
      earnings.coverage.status === 'complete' &&
      items!.every(
        (item) => item.label !== 'ยังไม่ระบุแพลตฟอร์ม' && BigInt(item.value.minor) >= 0n,
      );
    const tied = ranked![1]?.value.minor === leading.value.minor;
    highlights.push(
      `${label} ${complete && !tied ? 'ทำยอดขายสูงสุด' : 'ทำยอดขายได้'} ${formatMinor(leading.value.minor, true)} ในข้อมูลช่วงที่เลือก`,
    );
  }
  const top = earnings.topContent
    .filter((clip) => !clip.removed && clip.earned !== null && BigInt(clip.earned.minor) > 0n)
    .sort((a, b) =>
      BigInt(a.earned!.minor) > BigInt(b.earned!.minor)
        ? -1
        : BigInt(a.earned!.minor) < BigInt(b.earned!.minor)
          ? 1
          : 0,
    )[0];
  if (top) {
    highlights.push(
      `คลิปแบรนด์ ${top.brand} สร้างคอมมิชชัน ${formatMinor(top.earned!.minor, true)} ลองต่อยอดเป็นคลิปใหม่ในมุมที่ต่างออกไป`,
    );
  }
  if (!highlights.length)
    highlights.push('ลองเล่าประสบการณ์ใช้สินค้าในมุมใหม่ แล้วกลับมาดูผลของคลิปในช่วงถัดไป');
  return highlights;
}
