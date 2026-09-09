import { passwordPolicy } from '@/contracts/credentials';

/** Local, advisory estimate only. Never changes credential validation or sends the password. */
export function estimatePasswordStrength(value: string) {
  if (!value) return { level: 0, label: 'ยังไม่ได้กรอก', hint: '' };
  if (value.length < passwordPolicy.minLength)
    return {
      level: 0,
      label: 'ยังสั้น',
      hint: `ใช้อย่างน้อย ${passwordPolicy.minLength} ตัวอักษร`,
    };
  const predictable =
    /^(?:password|admin|qwerty|12345678)/i.test(value) ||
    /^(.{1,4})\1+$/u.test(value) ||
    new Set(value).size < 5;
  if (predictable)
    return { level: 1, label: 'เดาง่าย', hint: 'ลองใช้คำหลายคำที่คุณจำได้ จะเดายากขึ้น' };
  if (value.length < 12)
    return { level: 1, label: 'พอใช้', hint: 'เพิ่มความยาวได้ หากอยากให้เดายากขึ้น' };
  if (value.length < 16) return { level: 2, label: 'ดี', hint: '' };
  return { level: 3, label: 'ดีมาก', hint: '' };
}
