export class SourceUnavailableError extends Error {
  constructor() {
    super('ข้อมูลส่วนนี้ยังไม่พร้อม กรุณาติดต่อผู้ดูแล Labs D');
  }
}
/** Production composition has no approved financial read source yet. Never substitute fixtures. */
export async function sourceUnavailable(): Promise<never> {
  throw new SourceUnavailableError();
}
