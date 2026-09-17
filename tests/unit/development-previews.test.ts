import { describe, expect, it } from 'vitest';
import { developmentPreviewsEnabled } from '@/server/platform/development-previews';

describe('development preview isolation', () => {
  it('keeps mockups off in the ordinary development runtime', () => {
    expect(developmentPreviewsEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(
      developmentPreviewsEnabled({
        NODE_ENV: 'development',
        LABSD_DEVELOPMENT_PREVIEWS_ENABLED: '0',
      }),
    ).toBe(false);
  });
  it('requires an explicit development opt-in and never enables in production', () => {
    expect(
      developmentPreviewsEnabled({
        NODE_ENV: 'development',
        LABSD_DEVELOPMENT_PREVIEWS_ENABLED: '1',
      }),
    ).toBe(true);
    expect(
      developmentPreviewsEnabled({
        NODE_ENV: 'production',
        LABSD_DEVELOPMENT_PREVIEWS_ENABLED: '1',
      }),
    ).toBe(false);
  });
});
