import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { celebrityCatalogue } from '../../dev/financial/celebrity-catalogue';
describe('approved design catalogue fixture', () => {
  it('preserves all six cover assets and contains no invented money, views or source URLs', () => {
    const snapshot = celebrityCatalogue('synthetic-partner');
    expect(snapshot.clips.map((clip) => clip.id)).toEqual([
      'clip-1',
      'clip-2',
      'clip-3',
      'clip-4',
      'clip-5',
      'clip-6',
    ]);
    expect(snapshot.clips.map((clip) => clip.brand)).toEqual([
      'Axtion',
      'Axtion',
      'Tendrix',
      'Rusiren',
      'Melura',
      'Zenova',
    ]);
    for (const clip of snapshot.clips) {
      expect(clip.sourceUrl).toBeNull();
      expect(clip).not.toHaveProperty('earned');
      expect(clip).not.toHaveProperty('views');
      expect(clip.cover).not.toBeNull();
    }
    for (const path of [
      snapshot.profile.portrait,
      snapshot.profile.avatar,
      ...snapshot.clips.map((clip) => clip.cover),
    ])
      expect(existsSync(resolve('public', path!.slice(1))), path!).toBe(true);
  });
});
