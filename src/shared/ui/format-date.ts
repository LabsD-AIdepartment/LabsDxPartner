export function timestamp(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Bangkok',
      }).format(new Date(value))
    : 'ยังไม่มีข้อมูลจากต้นทาง';
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(
    new Date(value),
  );
}
