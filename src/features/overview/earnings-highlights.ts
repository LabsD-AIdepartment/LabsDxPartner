import type { OverviewValue } from '@/contracts/overview';
import type { MoneyValue } from '@/contracts/common';
import { platformSalesItems } from './platform-sales';

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
export type EarningsHighlight = {
  id: 'platform' | 'content' | 'idea';
  label: string;
  subject?: string;
  amount?: MoneyValue;
  description?: string;
};

export function earningsHighlights(earnings: OverviewValue['earnings']): EarningsHighlight[] {
  const highlights: EarningsHighlight[] = [];
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
    highlights.push({
      id: 'platform',
      label: complete && !tied ? 'ยอดขายสูงสุดในช่วงที่เลือก' : 'ยอดขายในข้อมูลช่วงที่เลือก',
      subject: label,
      amount: leading.value,
    });
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
    highlights.push({
      id: 'content',
      label: 'คอมมิชชันจากคลิป',
      subject: top.brand,
      amount: top.earned!,
      description: 'ลองต่อยอดเป็นคลิปใหม่ในมุมที่ต่างออกไป',
    });
  }
  if (!highlights.length)
    highlights.push({
      id: 'idea',
      label: 'ลองมุมใหม่ให้คลิปถัดไป',
      description: 'เล่าประสบการณ์ใช้สินค้า แล้วกลับมาดูผลในช่วงถัดไป',
    });
  return highlights;
}
