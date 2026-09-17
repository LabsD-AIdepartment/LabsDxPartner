import { describe, it, expect } from 'vitest';
import { parseShopVideoProfiles } from '@/server/modules/marketing-ads/tiktok-shop/video-config';
import { parseProvisionCommand } from '@/server/modules/marketing-ads/provision-command';
import {
  parseFacebookProfiles,
  readFacebookProfiles,
} from '@/server/modules/marketing-ads/facebook/config';
const command = {
  schemaVersion: 1,
  commandId: '00000000-0000-4000-8000-000000000001',
  operatorRef: 'operator-reference',
  evidenceRef: 'approval-reference',
  connectionId: 'fb-one',
  expectedRevision: null,
  label: 'Ads account',
  grantUserIds: ['b', 'a'],
  revokeUserIds: [],
};
describe('operator-only provisioning input', () => {
  it('normalizes explicit grant order and does not accept token or source-identity fields', () => {
    expect(parseProvisionCommand(command).grantUserIds).toEqual(['a', 'b']);
    for (const extra of [
      { token: 'private-value' },
      { accountId: 'other' },
      { enabled: true },
      { role: 'admin' },
    ])
      expect(() => parseProvisionCommand({ ...command, ...extra })).toThrow('invalid-input');
  });
  it('rejects ambiguous or unbounded grant changes and invalid expected revisions', () => {
    for (const extra of [
      { grantUserIds: ['a', 'a'] },
      { revokeUserIds: ['a'] },
      { grantUserIds: Array.from({ length: 101 }, (_, i) => String(i)) },
      { expectedRevision: '0' },
    ])
      expect(() => parseProvisionCommand({ ...command, ...extra })).toThrow('invalid-input');
  });
  it('can validate metadata while acquisition stays off, without resolving credentials', () => {
    const raw = JSON.stringify([
      {
        id: 'fb-one',
        namespace: 'test',
        accountId: '123',
        currency: 'THB',
        timezone: 'Asia/Bangkok',
        acquisitionOwner: 'portal-direct',
        tokenEnv: 'LABSD_FB_TEST_TOKEN',
      },
    ]);
    expect(readFacebookProfiles({ LABSD_FACEBOOK_PROFILES: raw })).toEqual([]);
    expect(parseFacebookProfiles(raw)).toHaveLength(1);
    expect(() =>
      parseFacebookProfiles(raw.replace('LABSD_FB_TEST_TOKEN', 'raw-private-token')),
    ).toThrow('Invalid Facebook profile');
  });
});

describe('TikTok video metadata configuration', () => {
  const profile = {
    connectionId: 'tiktok-one',
    namespace: 'labsd',
    shopId: '123456',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    acquisitionOwner: 'sale-dashboard',
    sourceConnectionRef: 'shop-connection-1',
  };
  it('accepts owner references without requiring or reading a source credential', () => {
    expect(parseShopVideoProfiles(JSON.stringify([profile]))).toEqual([profile]);
  });
  it('rejects raw secrets, arbitrary refresh owners, duplicate shops and conflicting owner references', () => {
    for (const change of [
      { token: 'private' },
      { accessToken: 'private' },
      { appSecret: 'private' },
      { acquisitionOwner: 'portal-direct' },
      { sourceConnectionRef: '' },
    ])
      expect(() => parseShopVideoProfiles(JSON.stringify([{ ...profile, ...change }]))).toThrow();
    for (const change of [{}, { connectionId: 'two' }, { connectionId: 'two', shopId: '789' }])
      expect(() =>
        parseShopVideoProfiles(JSON.stringify([profile, { ...profile, ...change }])),
      ).toThrow();
    expect(() => parseShopVideoProfiles('[]')).toThrow();
    expect(() => parseShopVideoProfiles('x'.repeat(64001))).toThrow();
  });
});
