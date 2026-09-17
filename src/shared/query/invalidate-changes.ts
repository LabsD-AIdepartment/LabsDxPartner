import type { Query, QueryClient } from '@tanstack/react-query';
import type { ChangeGroup } from '@/contracts/changes';
import { scopeKey, type QueryScope } from './keys';

/** A response can depend on several source revisions without splitting its atomic view. */
export const changeMeta = (...groups: ChangeGroup[]) => ({ changeGroups: [...new Set(groups)] });
export function dependsOnChanges(
  query: Pick<Query, 'queryKey' | 'meta'>,
  scope: QueryScope,
  groups: readonly ChangeGroup[],
) {
  const prefix = scopeKey(scope);
  if (!prefix.every((part, i) => query.queryKey[i] === part)) return false;
  const dependencies = query.meta?.changeGroups;
  return groups.some((group) =>
    Array.isArray(dependencies)
      ? dependencies.includes(group)
      : query.queryKey[prefix.length] === group,
  );
}
export async function invalidateChanges(
  client: QueryClient,
  scope: QueryScope,
  groups: readonly ChangeGroup[],
  options: { signal?: AbortSignal; throwOnError?: boolean } = {},
) {
  if (!groups.length) return;
  const predicate = (query: Query) => dependsOnChanges(query, scope, groups);
  // An initial pending request must be canceled too; invalidate alone can reuse that older read.
  const { signal, throwOnError = false } = options;
  const cancel = () => {
    void client.cancelQueries({ predicate });
  };
  signal?.throwIfAborted();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await client.cancelQueries({ predicate });
    signal?.throwIfAborted();
    await client.invalidateQueries({ predicate, refetchType: 'active' }, { throwOnError });
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
