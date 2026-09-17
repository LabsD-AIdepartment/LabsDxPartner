import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  createAdRegistrationTransport,
  marketingScope,
  type LookupMode,
} from '../../dev/ad-registration-transport';
import {
  readRegistration,
  resolveRegistration,
  saveRegistration,
  type AdRegistrationTransport,
} from '@/features/marketing-ads/model';
import type { AdDraftValue } from '@/contracts/ad-registration';
import { AdRegistrationConsole } from '@/features/marketing-ads/AdRegistrationConsole';
import { IsolatedQueryProvider } from '@/shared/query/provider';
const signal = () => new AbortController().signal;
const draft: AdDraftValue = {
  targetId: 'target-clip-1',
  platform: 'facebook',
  connectionId: 'fb-main',
  externalId: '000900719925474099312345',
};
async function setup() {
  const adapter = createAdRegistrationTransport({ latency: 0 });
  const value = await readRegistration(adapter.transport, marketingScope, signal());
  return { ...adapter, value };
}
describe('Marketing registration contract and synthetic authority', () => {
  it.each([
    ['facebook', 'fb-main'],
    ['shopee', 'shopee-main'],
    ['lazada', 'lazada-main'],
    ['tiktok', 'tiktok-main'],
  ] as const)(
    'resolves and saves %s with opaque IDs, source identity and target context',
    async (platform, connectionId) => {
      const { transport, value } = await setup();
      const input = { ...draft, platform, connectionId };
      const resolved = await resolveRegistration(transport, marketingScope, value, input, signal());
      const result = await saveRegistration(
        transport,
        marketingScope,
        value,
        resolved,
        input,
        signal(),
      );
      expect(result.association).toMatchObject({
        externalId: draft.externalId,
        sync: 'queued',
        target: { partnerId: 'partner-owner', clipId: 'clip-1', agreementId: 'agreement-owner' },
      });
      expect(result.association).not.toHaveProperty('commission');
    },
  );
  it('replays duplicate registration, rejects reassignment, and separates identical IDs in different accounts', async () => {
    const { transport, value } = await setup();
    const resolved = await resolveRegistration(transport, marketingScope, value, draft, signal());
    const first = await saveRegistration(
      transport,
      marketingScope,
      value,
      resolved,
      draft,
      signal(),
    );
    const replay = await saveRegistration(
      transport,
      marketingScope,
      value,
      resolved,
      draft,
      signal(),
    );
    expect(replay).toMatchObject({ replayed: true, association: { id: first.association.id } });
    for (const targetId of ['target-clip-2', 'target-other']) {
      const changed = { ...draft, targetId };
      const found = await resolveRegistration(transport, marketingScope, value, changed, signal());
      await expect(
        saveRegistration(transport, marketingScope, value, found, changed, signal()),
      ).rejects.toMatchObject({ code: 'conflict' });
    }
    const other = { ...draft, connectionId: 'fb-second' };
    const found = await resolveRegistration(transport, marketingScope, value, other, signal());
    const saved = await saveRegistration(transport, marketingScope, value, found, other, signal());
    expect(saved.association.id).not.toBe(first.association.id);
    expect((await readRegistration(transport, marketingScope, signal())).associations).toHaveLength(
      2,
    );
  });
  it.each(['not-found', 'denied', 'unsupported', 'ambiguous', 'temporary'] as LookupMode[])(
    'does not create mappings when lookup is %s',
    async (mode) => {
      const adapter = await setup();
      adapter.setMode(mode);
      await expect(
        resolveRegistration(adapter.transport, marketingScope, adapter.value, draft, signal()),
      ).rejects.toMatchObject({ code: mode });
      expect(
        (await readRegistration(adapter.transport, marketingScope, signal())).associations,
      ).toHaveLength(0);
    },
  );
  it('rejects foreign actor/target/account, expired connection and a platform/account mismatch', async () => {
    const { transport, value } = await setup();
    await expect(
      transport.read({ scope: { ...marketingScope, actorId: 'foreign' }, signal: signal() }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    for (const patch of [
      { targetId: 'not-authorized' },
      { connectionId: 'foreign' },
      { platform: 'tiktok' as const },
    ])
      await expect(
        transport.resolve({
          scope: marketingScope,
          draft: { ...draft, ...patch },
          signal: signal(),
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      resolveRegistration(
        transport,
        marketingScope,
        value,
        { ...draft, connectionId: 'fb-expired' },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'denied' });
  });
  it('rechecks receipt, target and current capability on save, including direct transport calls', async () => {
    const adapter = await setup();
    const found = await resolveRegistration(
      adapter.transport,
      marketingScope,
      adapter.value,
      draft,
      signal(),
    );
    const request = { scope: marketingScope, receipt: found.receipt, draft, signal: signal() };
    await expect(adapter.transport.save({ ...request, receipt: 'forged' })).rejects.toMatchObject({
      code: 'expired',
    });
    await expect(
      adapter.transport.save({ ...request, draft: { ...draft, targetId: 'target-other' } }),
    ).rejects.toMatchObject({ code: 'expired' });
    adapter.setMode('read-only');
    await expect(adapter.transport.save(request)).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      (await readRegistration(adapter.transport, marketingScope, signal())).associations,
    ).toHaveLength(0);
  });
  it('expires lookup receipts and advances synthetic jobs automatically without conflating source cutoff and fetch time', async () => {
    let now = Date.now();
    const adapter = createAdRegistrationTransport({ now: () => now, latency: 0 });
    const value = await readRegistration(adapter.transport, marketingScope, signal());
    const found = await resolveRegistration(
      adapter.transport,
      marketingScope,
      value,
      draft,
      signal(),
    );
    await saveRegistration(adapter.transport, marketingScope, value, found, draft, signal());
    now += 700;
    expect(
      (await readRegistration(adapter.transport, marketingScope, signal())).associations[0].sync,
    ).toBe('syncing');
    now += 2000;
    const row = (await readRegistration(adapter.transport, marketingScope, signal()))
      .associations[0];
    expect(row.sync).toBe('ready');
    expect(row.lastSuccessAt).not.toEqual(row.dataThrough);
    now += 120000;
    await expect(
      adapter.transport.save({
        scope: marketingScope,
        draft,
        receipt: found.receipt,
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: 'expired' });
  });
  it('shows actionable sync failure without fabricated success then recovers after connection repair', async () => {
    let now = Date.now();
    const adapter = createAdRegistrationTransport({ now: () => now, latency: 0 });
    const value = await readRegistration(adapter.transport, marketingScope, signal());
    const found = await resolveRegistration(
      adapter.transport,
      marketingScope,
      value,
      draft,
      signal(),
    );
    adapter.setSyncFailure(true);
    await saveRegistration(adapter.transport, marketingScope, value, found, draft, signal());
    now += 3000;
    const failed = (await readRegistration(adapter.transport, marketingScope, signal()))
      .associations[0];
    expect(failed).toMatchObject({
      sync: 'needs-attention',
      lastSuccessAt: null,
      dataThrough: null,
    });
    adapter.setSyncFailure(false);
    expect(
      (await readRegistration(adapter.transport, marketingScope, signal())).associations[0].sync,
    ).toBe('ready');
  });
  it('rejects mismatched resolved provenance and cross-partner list data', async () => {
    const { transport, value } = await setup();
    const wrong: AdRegistrationTransport = {
      ...transport,
      resolve: async (request) => ({
        ...((await transport.resolve(request)) as object),
        accountId: 'wrong-account',
      }),
    };
    await expect(
      resolveRegistration(wrong, marketingScope, value, draft, signal()),
    ).rejects.toMatchObject({ code: 'invalid' });
    const found = await resolveRegistration(transport, marketingScope, value, draft, signal());
    await saveRegistration(transport, marketingScope, value, found, draft, signal());
    const snapshot = await readRegistration(transport, marketingScope, signal());
    snapshot.associations[0].target.partnerId = 'foreign';
    await expect(
      readRegistration({ ...transport, read: async () => snapshot }, marketingScope, signal()),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('aborts superseded lookups', async () => {
    const adapter = await setup();
    const controller = new AbortController();
    const pending = resolveRegistration(
      adapter.transport,
      marketingScope,
      adapter.value,
      draft,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
function mount(transport: AdRegistrationTransport, initialTargetId?: string) {
  return render(
    <IsolatedQueryProvider identity={['marketing-test']}>
      <AdRegistrationConsole
        scope={marketingScope}
        transport={transport}
        initialTargetId={initialTargetId}
      />
    </IsolatedQueryProvider>,
  );
}
describe('Marketing registration shared UI', () => {
  it('uses inherited context and a sole connection, resolves, saves and suppresses duplicates', async () => {
    const adapter = await setup();
    mount(adapter.transport, 'target-clip-3');
    const platform = await screen.findByLabelText('แพลตฟอร์ม');
    expect(screen.getByLabelText('คลิปและข้อตกลง')).toHaveValue('target-clip-3');
    expect(
      Array.from((platform as HTMLSelectElement).options).map((option) => option.text),
    ).toEqual(['Facebook', 'Shopee', 'Lazada', 'TikTok']);
    fireEvent.change(platform, { target: { value: 'shopee' } });
    expect(screen.queryByRole('combobox', { name: 'บัญชีโฆษณาหรือร้านค้า' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Ad ID'), { target: { value: draft.externalId } });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหาแอด' }));
    fireEvent.click(await screen.findByRole('button', { name: 'เชื่อมแอดนี้กับคลิป' }));
    await screen.findByText('แอดที่เชื่อมแล้ว (1)');
    expect(screen.getByText('รอดึงข้อมูลครั้งแรก')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหาแอด' }));
    fireEvent.click(await screen.findByRole('button', { name: 'เชื่อมแอดนี้กับคลิป' }));
    await screen.findByText('แอดนี้เชื่อมกับคลิปนี้ไว้แล้ว ไม่มีการบันทึกซ้ำ');
    expect(screen.getByText('แอดที่เชื่อมแล้ว (1)')).toBeVisible();
  });
  it('shows lookup errors and never offers save for an ambiguous creative', async () => {
    const adapter = await setup();
    adapter.setMode('ambiguous');
    mount(adapter.transport);
    fireEvent.change(await screen.findByLabelText('Ad ID'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหาแอด' }));
    await screen.findByText(/แอดนี้มีหลายชิ้นงาน/);
    expect(screen.queryByRole('button', { name: 'เชื่อมแอดนี้กับคลิป' })).toBeNull();
  });
  it('discarding a draft aborts lookup and a late response cannot show the old result', async () => {
    const adapter = await setup();
    let release!: () => void;
    let sourceSignal!: AbortSignal;
    const transport = {
      ...adapter.transport,
      resolve: vi.fn(async (request: Parameters<AdRegistrationTransport['resolve']>[0]) => {
        const value = await adapter.transport.resolve(request);
        sourceSignal = request.signal;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return value;
      }),
    };
    mount(transport);
    fireEvent.change(await screen.findByLabelText('Ad ID'), { target: { value: 'old-id' } });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหาแอด' }));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Ad ID'), { target: { value: 'new-id' } });
    expect(sourceSignal.aborted).toBe(true);
    await act(async () => release());
    expect(screen.queryByText('โฆษณาตัวอย่าง old-id')).toBeNull();
    expect(screen.queryByRole('button', { name: 'เชื่อมแอดนี้กับคลิป' })).toBeNull();
  });
  it('has no write path in read-only mode and blocks unknown inherited targets', async () => {
    const adapter = await setup();
    adapter.setMode('read-only');
    const first = mount(adapter.transport);
    expect(await screen.findByRole('button', { name: 'ค้นหาแอด' })).toBeDisabled();
    first.unmount();
    adapter.setMode('ready');
    mount(adapter.transport, 'foreign-target');
    expect(await screen.findByRole('button', { name: 'ค้นหาแอด' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('ไม่พบคลิป');
  });
});
