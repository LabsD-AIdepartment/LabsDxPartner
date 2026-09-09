import { CatalogueSnapshot } from '@/contracts/catalogue';
import { readyScenario } from '../scenarios/ready';

/** Owner-as-celebrity test data. This is never a production source or fixture fallback. */
export function celebrityCatalogue(partnerId: string) {
  return CatalogueSnapshot.parse({
    schema: 'partner-catalogue/1',
    mode: 'complete-snapshot',
    partnerId,
    sourceRevision: 'synthetic-catalogue-1',
    evidenceRef: 'synthetic-approved-design',
    profile: {
      name: 'คุณ',
      role: 'Celebrity partner',
      portrait: '/media/celebrity-thumbnail.png',
      avatar: '/media/celebrity-avatar.png',
    },
    clips: readyScenario().content.data.items.map(
      ({ id, title, brand, publishedAt, cover, coverPosition, removed }) => ({
        id,
        title,
        brand,
        publishedAt,
        cover,
        coverPosition,
        removed,
        // Reference screenshots do not establish a real platform clip URL.
        sourceUrl: null,
      }),
    ),
  });
}
