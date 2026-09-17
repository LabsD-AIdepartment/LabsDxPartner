import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatasetBoundary, useDemoDataset } from '../../dev/demo-dataset/DatasetBoundary';
import { loadDemoDataset } from '../../dev/demo-dataset/client';
import type { DatasetRecords } from '../../dev/demo-dataset/dataset';
import type { PreviewIdentity } from '../../dev/withdrawals/navigation';

vi.mock('../../dev/demo-dataset/client', () => ({
  loadDemoDataset: vi.fn(),
  createDemoSession: (dataset: DatasetRecords) => ({ dataset }),
}));
const load = vi.mocked(loadDemoDataset);
const snapshot = (identity: PreviewIdentity, generation = 'g1') =>
  ({ meta: { datasetId: `partner-demo-${identity}`, generation } }) as DatasetRecords;
function Consumer({ identity }: { identity: PreviewIdentity }) {
  const data = useDemoDataset(identity);
  return (
    <p>
      {data.meta.datasetId}:{data.meta.generation}
    </p>
  );
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => load.mockReset());

describe('database demo boundary', () => {
  it('does not mount financial consumers until the requested snapshot is ready', async () => {
    const request = pending<DatasetRecords>();
    load.mockReturnValue(request.promise);
    render(
      <DatasetBoundary identities={['a']}>
        <Consumer identity="a" />
      </DatasetBoundary>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ฐานข้อมูล');
    expect(screen.queryByText('partner-demo-a:g1')).not.toBeInTheDocument();
    request.resolve(snapshot('a'));
    expect(await screen.findByText('partner-demo-a:g1')).toBeVisible();
  });

  it('fails visibly without a legacy fallback and retries with a fresh request', async () => {
    load.mockRejectedValueOnce(new Error('missing database')).mockResolvedValueOnce(snapshot('a'));
    render(
      <DatasetBoundary>
        <Consumer identity="a" />
      </DatasetBoundary>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดชุดข้อมูลตัวอย่าง');
    expect(screen.queryByText('partner-demo-a:g1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(await screen.findByText('partner-demo-a:g1')).toBeVisible();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('aborts the previous identity and rejects its late response after switching', async () => {
    const a = pending<DatasetRecords>(),
      b = pending<DatasetRecords>();
    load.mockImplementation((identity) => (identity === 'a' ? a.promise : b.promise));
    const view = render(
      <DatasetBoundary identities={['a']}>
        <Consumer identity="a" />
      </DatasetBoundary>,
    );
    const oldSignal = load.mock.calls[0][1];
    view.rerender(
      <DatasetBoundary identities={['b']}>
        <Consumer identity="b" />
      </DatasetBoundary>,
    );
    expect(oldSignal.aborted).toBe(true);
    b.resolve(snapshot('b', 'g2'));
    expect(await screen.findByText('partner-demo-b:g2')).toBeVisible();
    a.resolve(snapshot('a'));
    await waitFor(() => expect(screen.queryByText('partner-demo-a:g1')).not.toBeInTheDocument());
    expect(screen.getByText('partner-demo-b:g2')).toBeVisible();
    const activeSignal = load.mock.calls[1][1];
    view.unmount();
    expect(activeSignal.aborted).toBe(true);
  });

  it('removes already-visible amounts synchronously when identity changes', async () => {
    const b = pending<DatasetRecords>();
    load.mockImplementation((identity) =>
      identity === 'a' ? Promise.resolve(snapshot('a')) : b.promise,
    );
    const view = render(
      <DatasetBoundary identities={['a']}>
        <Consumer identity="a" />
      </DatasetBoundary>,
    );
    expect(await screen.findByText('partner-demo-a:g1')).toBeVisible();
    view.rerender(
      <DatasetBoundary identities={['b']}>
        <Consumer identity="b" />
      </DatasetBoundary>,
    );
    expect(screen.queryByText('partner-demo-a:g1')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeVisible();
    b.resolve(snapshot('b'));
    expect(await screen.findByText('partner-demo-b:g1')).toBeVisible();
  });

  it('keeps staff consumers unmounted until both independent identity snapshots are ready', async () => {
    const b = pending<DatasetRecords>();
    load.mockImplementation((identity) =>
      identity === 'a' ? Promise.resolve(snapshot('a')) : b.promise,
    );
    render(
      <DatasetBoundary identities={['a', 'b']}>
        <Consumer identity="a" />
        <Consumer identity="b" />
      </DatasetBoundary>,
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('partner-demo-a:g1')).not.toBeInTheDocument();
    b.resolve(snapshot('b'));
    expect(await screen.findByText('partner-demo-a:g1')).toBeVisible();
    expect(screen.getByText('partner-demo-b:g1')).toBeVisible();
  });
});
