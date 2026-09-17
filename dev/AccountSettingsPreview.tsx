'use client';
import { useEffect, useState } from 'react';
import type {
  AccountSettingsSnapshotValue,
  SettingsScopeValue,
} from '@/contracts/account-settings';
import {
  loadAccountSettings,
  type AccountSettingsTransport,
} from '@/features/account/settings-model';
import {
  browserAccountSettingsStorage,
  createAccountSettingsTransport,
} from './account-settings-transport';
import { payoutPreviewHref, type PreviewIdentity } from './withdrawals/navigation';

/** The browser mount owns the storage adapter; SSR must never initialize its read-fault state. */
export function usePreviewAccountSettings(scope: SettingsScopeValue, identity: PreviewIdentity) {
  const signature = JSON.stringify([
    scope.userId,
    scope.partnerId,
    scope.permissionRevision,
    identity,
  ]);
  const [state, setState] = useState<{
    signature: string;
    transport: AccountSettingsTransport;
    snapshot: AccountSettingsSnapshotValue | null;
    status: 'loading' | 'ready' | 'error';
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const transport = createAccountSettingsTransport({
      scope: {
        userId: scope.userId,
        partnerId: scope.partnerId,
        permissionRevision: scope.permissionRevision,
      },
      storage: browserAccountSettingsStorage,
      initial: {
        displayName: `พาร์ตเนอร์ ${identity.toUpperCase()}`,
        currentUsername: `partner.${identity}`,
      },
    });
    setState({ signature, transport, snapshot: null, status: 'loading' });
    void loadAccountSettings(
      transport,
      {
        userId: scope.userId,
        partnerId: scope.partnerId,
        permissionRevision: scope.permissionRevision,
      },
      controller.signal,
    ).then(
      (snapshot) => {
        if (!controller.signal.aborted)
          setState({ signature, transport, snapshot, status: 'ready' });
      },
      () => {
        if (!controller.signal.aborted)
          setState({ signature, transport, snapshot: null, status: 'error' });
      },
    );
    return () => controller.abort();
  }, [signature, scope.userId, scope.partnerId, scope.permissionRevision, identity]);
  const current = state?.signature === signature ? state : null;
  return {
    scope: {
      userId: scope.userId,
      partnerId: scope.partnerId,
      permissionRevision: scope.permissionRevision,
    },
    transport: current?.transport ?? null,
    snapshot: current?.snapshot ?? null,
    status: current?.status ?? 'loading',
    onSnapshot: (snapshot: AccountSettingsSnapshotValue) =>
      setState((previous) =>
        previous?.signature === signature ? { ...previous, snapshot, status: 'ready' } : previous,
      ),
  };
}

/** Profile navigation reaches management; explicit payout links keep their own subview. */
export function accountManagementPreviewHref(lane: Parameters<typeof payoutPreviewHref>[1]) {
  const params = new URLSearchParams(payoutPreviewHref('/account-preview', lane).split('?')[1]);
  params.delete('view');
  return '/account-preview?' + params.toString();
}
