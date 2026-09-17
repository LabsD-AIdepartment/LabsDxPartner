import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ContentCard } from '@/features/content/ContentCard';
const href = '/content/clip-owned?from=2026-07-01&toExclusive=2026-09-01&generation=12';
const base = {
  id: 'clip-owned',
  title: 'คลิปของพาร์ทเนอร์',
  brand: 'Axtion',
  publishedAt: '2026-08-01T00:00:00Z',
  cover: '/media/clip-owned.jpg',
  coverPosition: 'center',
  removed: false,
  views: 1200,
  earned: { currency: 'THB' as const, minor: '123456' },
  unavailableReason: null,
};
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false;
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('content thumbnail media and real external identifiers', () => {
  it('opens the image instead of navigating and retains the same detail/report link', () => {
    render(<ContentCard clip={base} href={href} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', href);
    expect(within(link).getByText('฿1,234.56')).toBeVisible();
    const button = screen.getByRole('button', { name: `ขยายภาพ ${base.title}` });
    expect(button.closest('a')).toBeNull();
    expect(within(button).getByText('ดูคลิป')).toHaveAttribute('aria-hidden', 'true');
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: base.title });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', base.cover);
    expect(dialog.querySelector('video')).toBeNull();
    expect(link).toHaveAttribute('href', href);
    fireEvent.load(within(dialog).getByRole('img'));
    expect(within(dialog).queryByRole('status')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ปิดหน้าต่าง' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });
  it('shows all platform IDs below title without coercing long strings or inventing internal IDs', () => {
    const adReferences = [
      { platform: 'facebook' as const, externalId: '12000000000000000000001234567890' },
      { platform: 'tiktok' as const, externalId: '00012345678901234567890' },
    ];
    render(<ContentCard clip={{ ...base, adReferences }} href={href} />);
    expect(screen.getByText(adReferences[0].externalId)).toBeVisible();
    expect(screen.getByText(adReferences[1].externalId)).toBeVisible();
    expect(screen.queryByText(base.id)).toBeNull();
    const title = screen.getByText(base.title, { selector: 'strong' });
    expect(title).toHaveAttribute('title', base.title);
    const platform = screen.getByText('Facebook');
    expect(platform.nextElementSibling).toHaveTextContent('Ads ID:');
    expect(platform).not.toHaveTextContent(adReferences[0].externalId);
    expect(
      title.compareDocumentPosition(screen.getByText(adReferences[0].externalId)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it.each([undefined, null])('uses concise unknown Ad ID for %s', (adReferences) => {
    render(<ContentCard clip={{ ...base, adReferences }} href={href} />);
    expect(screen.getByText('Ads ID —')).toBeVisible();
  });
  it('distinguishes verified no IDs from unavailable IDs', () => {
    render(<ContentCard clip={{ ...base, adReferences: [] }} href={href} />);
    expect(screen.getByText('ยังไม่มี Ads ID')).toBeVisible();
  });
  it('plays only a declared local video, with native controls, and releases it on Escape', () => {
    render(
      <ContentCard
        clip={{ ...base, media: { kind: 'video', src: '/media/owned.mp4', poster: base.cover } }}
        href={href}
      />,
    );
    const button = screen.getByRole('button', { name: `ดูวิดีโอ ${base.title}` });
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog');
    const video = dialog.querySelector('video')!;
    expect(video).toHaveAttribute('src', '/media/owned.mp4');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('tabindex', '0');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video).not.toHaveAttribute('autoplay');
    fireEvent.loadedMetadata(video);
    expect(within(dialog).queryByRole('status')).toBeNull();
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(video.pause).toHaveBeenCalled();
    expect(video).not.toHaveAttribute('src');
    expect(video.load).toHaveBeenCalled();
    expect(button).toHaveFocus();
  });
  it('uses actual video dimensions instead of the poster ratio and updates for track resizing', () => {
    render(
      <ContentCard
        clip={{ ...base, media: { kind: 'video', src: '/media/owned.mp4', poster: base.cover } }}
        href={href}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: `ดูวิดีโอ ${base.title}` }));
    const player = screen.getByRole('dialog').querySelector('video')!;
    Object.defineProperty(player, 'videoWidth', { configurable: true, value: 720 });
    Object.defineProperty(player, 'videoHeight', { configurable: true, value: 1280 });
    fireEvent.loadedMetadata(player);
    expect(player).toHaveStyle({ aspectRatio: '720 / 1280' });
    Object.defineProperty(player, 'videoWidth', { configurable: true, value: 1920 });
    Object.defineProperty(player, 'videoHeight', { configurable: true, value: 1080 });
    fireEvent(player, new Event('resize'));
    expect(player).toHaveStyle({ aspectRatio: '1920 / 1080' });
    Object.defineProperty(player, 'videoHeight', { configurable: true, value: 0 });
    fireEvent(player, new Event('resize'));
    expect(player).toHaveStyle({ aspectRatio: '1920 / 1080' });
    expect(player).toHaveAttribute('src', '/media/owned.mp4');
    expect(player).not.toHaveAttribute('autoplay');
    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }));
  });
  it('retries failed media and bounds indefinitely loading media', () => {
    vi.useFakeTimers();
    render(
      <ContentCard
        clip={{ ...base, media: { kind: 'video', src: '/media/owned.webm' } }}
        href={href}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: `ดูวิดีโอ ${base.title}` }));
    const dialog = screen.getByRole('dialog');
    const original = dialog.querySelector('video')!;
    fireEvent.error(original);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('โหลดวิดีโอไม่สำเร็จ');
    expect(original.pause).toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(dialog.querySelector('video')).not.toBe(original);
    act(() => vi.advanceTimersByTime(15_000));
    expect(within(dialog).getByRole('alert')).toBeVisible();
    expect(dialog.querySelector('video')).toBeNull();
  });
  it('never plays removed media and keeps historic detail/earnings accessible', () => {
    render(
      <ContentCard
        clip={{ ...base, removed: true, media: { kind: 'video', src: '/media/owned.mp4' } }}
        href={href}
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', href);
    expect(screen.getByText('฿1,234.56')).toBeVisible();
  });
});

it('restores the canonical video source after StrictMode effect replay and unloads on real close', () => {
  render(
    <StrictMode>
      <ContentCard
        clip={{ ...base, media: { kind: 'video', src: '/media/owned.mp4' } }}
        href={href}
      />
    </StrictMode>,
  );
  const button = screen.getByRole('button', { name: `ดูวิดีโอ ${base.title}` });
  button.focus();
  fireEvent.click(button);
  const dialog = screen.getByRole('dialog');
  const player = dialog.querySelector('video')!;
  // Effect replay really ran cleanup; checking the DOM src catches the lost-resource bug.
  expect(player.pause).toHaveBeenCalled();
  expect(player).toHaveAttribute('src', '/media/owned.mp4');
  expect(player.load).toHaveBeenCalled();
  fireEvent.loadedMetadata(player);
  expect(within(dialog).queryByRole('status')).toBeNull();
  const pauses = vi.mocked(player.pause).mock.calls.length;
  const loads = vi.mocked(player.load).mock.calls.length;
  fireEvent.click(within(dialog).getByRole('button', { name: 'ปิดหน้าต่าง' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(player.pause).toHaveBeenCalledTimes(pauses + 1);
  expect(player.load).toHaveBeenCalledTimes(loads + 1);
  expect(player).not.toHaveAttribute('src');
  expect(button).toHaveFocus();
});
