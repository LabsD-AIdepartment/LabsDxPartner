import type { AccountTransport } from './model';
export const accountHttp: AccountTransport = {
  async read(scope, signal) {
    const query = new URLSearchParams({
      partnerId: scope.partnerId,
      permissionRevision: scope.permissionRevision,
    });
    const response = await fetch('/api/v1/partner/account?' + query, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error('โหลดบัญชีไม่สำเร็จ กรุณาลองอีกครั้ง');
    return response.json();
  },
  async act({ scope, command, signal }) {
    if (command.action === 'logout') {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
    return {
      userId: scope.userId,
      requestId: crypto.randomUUID(),
      status: command.action === 'logout' ? 'complete' : 'recovery-required',
      message:
        command.action === 'logout'
          ? 'ออกจากระบบแล้ว'
          : 'ติดต่อผู้ดูแล Labs D ที่ประสานงานกับคุณเพื่อขอลิงก์ตั้งรหัสผ่านใหม่',
    };
  },
};
