import styles from './ui.module.css';
export type Status =
  'estimated' | 'confirmed' | 'adjustment' | 'pending' | 'part-paid' | 'paid' | 'credit';
const names: Record<Status, string> = {
  estimated: 'ยอดประมาณการ',
  confirmed: 'ยืนยันแล้ว',
  adjustment: 'รายการปรับปรุง',
  pending: 'รอจ่าย',
  'part-paid': 'จ่ายบางส่วน',
  paid: 'จ่ายแล้ว',
  credit: 'เครดิตยกไป',
};
export function StatusBadge({ status }: { status: Status }) {
  return <span className={styles.badge}>{names[status]}</span>;
}
