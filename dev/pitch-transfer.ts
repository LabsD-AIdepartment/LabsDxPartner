import { PitchTransfer, type PitchTransferValue } from '@/contracts/pitch-transfer';
import { PersistedState, WITHDRAWAL_SCENARIO_MARKER } from './withdrawals/store';
import { PersistedBeneficiaryConfigV1 } from './withdrawals/beneficiary-store';
import { pitchStorageKey } from './pitch-storage';
export function validatePitchTransfer(raw: unknown, userId: string, partnerId: string) {
  const data = PitchTransfer.parse(raw);
  if (data.userId !== userId || data.partnerId !== partnerId) throw new Error('บัญชีไม่ตรงกัน');
  for (const entry of data.entries) {
    const beneficiary = entry.key.startsWith(WITHDRAWAL_SCENARIO_MARKER + '::beneficiary::');
    const state = (beneficiary ? PersistedBeneficiaryConfigV1 : PersistedState).parse(JSON.parse(entry.value));
    const s = state.scope;
    const key = [WITHDRAWAL_SCENARIO_MARKER, ...(beneficiary ? ['beneficiary'] : []), s.scenario, s.userId, s.partnerId, s.permissionRevision, s.payerId, s.currency].map(encodeURIComponent).join('::');
    if (entry.key !== key) throw new Error('ข้อมูลการถอนผิดขอบเขต');
  }
  return data;
}
export function exportPitchTransfer(storage: Storage, userId: string, partnerId: string) {
  const prefix = pitchStorageKey('');
  const entries: PitchTransferValue['entries'] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix + WITHDRAWAL_SCENARIO_MARKER + '::')) entries.push({key:key.slice(prefix.length),value:storage.getItem(key)!});
  }
  return validatePitchTransfer({version:1,userId,partnerId,entries},userId,partnerId);
}
export function importPitchTransfer(storage: Storage, raw: unknown, userId: string, partnerId: string, overwrite = false) {
  const data = validatePitchTransfer(raw,userId,partnerId);
  const entries = data.entries.filter(entry => overwrite || storage.getItem(pitchStorageKey(entry.key)) === null);
  const prior = entries.map(entry => storage.getItem(pitchStorageKey(entry.key)));
  try { entries.forEach(entry => storage.setItem(pitchStorageKey(entry.key),entry.value)); }
  catch (error) {
    entries.forEach((entry,i) => { try { const key=pitchStorageKey(entry.key); if (prior[i]===null) storage.removeItem(key); else storage.setItem(key,prior[i]!); } catch { /* Existing controller surfaces storage faults. */ } });
    throw error;
  }
}
