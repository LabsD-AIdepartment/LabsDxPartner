import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PitchTransfer } from '@/contracts/pitch-transfer';
export async function readPitchTransfer(userId: string, partnerId: string) {
  if (!process.env.LABSD_HOSTED_DATA_DIR) return undefined;
  const path = join(process.env.LABSD_HOSTED_DATA_DIR, 'pitch-wallet-state.json');
  try {
    if ((await stat(path)).size > 2_000_000) throw new Error('Invalid pitch transfer');
    const data = PitchTransfer.parse(JSON.parse(await readFile(path, 'utf8')));
    if (data.userId !== userId || data.partnerId !== partnerId) throw new Error('Invalid pitch transfer');
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Pitch wallet transfer unavailable');
  }
}
