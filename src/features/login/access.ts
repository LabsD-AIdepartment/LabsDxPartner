import { safeReturnTo } from '@/shared/routing/partner-paths';
export { safeReturnTo, loginHref } from '@/shared/routing/partner-paths';
/** URL values describe presentation only. They never establish access. */
export const accessReasons = [
  'invite-required',
  'pending',
  'invite-expired',
  'invite-used',
  'cancelled',
  'retry',
  'suspended',
  'provider-unavailable',
  'session-expired',
] as const;
export type AccessReason = (typeof accessReasons)[number];
export function parseAccessReason(value: unknown): AccessReason {
  return typeof value === 'string' && accessReasons.includes(value as AccessReason)
    ? (value as AccessReason)
    : 'invite-required';
}
export function accessHref(reason: AccessReason, next: unknown) {
  return `/access?reason=${reason}&next=${encodeURIComponent(safeReturnTo(next))}`;
}
export const accessCopy: Record<
  AccessReason,
  { title: string; description: string; action: string }
> = {
  'invite-required': {
    title: 'เริ่มต้นด้วยคำเชิญ',
    description:
      'พื้นที่นี้สำหรับพาร์ทเนอร์ของ Labs D หากยังไม่มีคำเชิญ โปรดติดต่อผู้ดูแลที่ประสานงานกับคุณ',
    action: 'กลับไปหน้าเข้าสู่ระบบ',
  },
  pending: {
    title: 'กำลังตรวจสอบสิทธิ์ของคุณ',
    description:
      'เมื่อทีมงานยืนยันการเป็นพาร์ทเนอร์แล้ว คุณจะเข้าดูข้อมูลของตัวเองได้ หากรอนานกว่าที่นัดหมาย โปรดติดต่อผู้ดูแลของคุณ',
    action: 'กลับไปตรวจสอบอีกครั้ง',
  },
  'invite-expired': {
    title: 'คำเชิญนี้หมดอายุแล้ว',
    description:
      'ขอคำเชิญใหม่จากผู้ดูแล Labs D แล้วเปิดลิงก์ใหม่ที่ได้รับ เพื่อเริ่มต้นอย่างปลอดภัย',
    action: 'กลับไปหน้าเข้าสู่ระบบ',
  },
  'invite-used': {
    title: 'คำเชิญนี้ถูกใช้แล้ว',
    description:
      'หากคุณเคยรับคำเชิญแล้ว ให้เข้าสู่ระบบด้วยบัญชีเดิม หากไม่ใช่คุณ โปรดติดต่อผู้ดูแล Labs D',
    action: 'เข้าสู่ระบบด้วยบัญชีเดิม',
  },
  cancelled: {
    title: 'คุณยกเลิกการเข้าสู่ระบบ',
    description: 'ยังไม่ได้เข้าสู่ระบบ คุณสามารถเลือกบัญชีและลองอีกครั้งได้ทุกเมื่อ',
    action: 'ลองเข้าสู่ระบบอีกครั้ง',
  },
  retry: {
    title: 'ยังเข้าสู่ระบบไม่สำเร็จ',
    description:
      'อาจเกิดจากการเชื่อมต่อขัดข้อง กรุณาลองอีกครั้ง หากยังพบปัญหา โปรดติดต่อผู้ดูแลของคุณ',
    action: 'ลองอีกครั้ง',
  },
  suspended: {
    title: 'การเข้าถึงถูกพักชั่วคราว',
    description:
      'โปรดติดต่อผู้ดูแล Labs D เพื่อตรวจสอบสิทธิ์ก่อนกลับมาใช้งาน ข้อมูลของคุณยังไม่เปิดให้เข้าถึงจากหน้านี้',
    action: 'กลับไปหน้าเข้าสู่ระบบ',
  },
  'provider-unavailable': {
    title: 'กำลังเตรียมเปิดการเข้าสู่ระบบ',
    description:
      'การเชื่อมต่อ Google, LINE และ Apple ยังไม่เปิดใช้งาน ขณะนี้ยังไม่มีการเชื่อมบัญชีหรือบันทึกข้อมูลการเข้าสู่ระบบของคุณ',
    action: 'กลับไปหน้าเข้าสู่ระบบ',
  },
  'session-expired': {
    title: 'กรุณาเข้าสู่ระบบอีกครั้ง',
    description: 'เพื่อความปลอดภัย กรุณายืนยันตัวตนอีกครั้งก่อนดูข้อมูลของคุณ',
    action: 'เข้าสู่ระบบอีกครั้ง',
  },
};
