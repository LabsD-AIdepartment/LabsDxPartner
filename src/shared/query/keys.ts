import type { ChangeGroup } from '@/contracts/changes';
export type QueryScope = Readonly<{
  userId: string;
  partnerId: string;
  permissionRevision: string;
}>;
export function scopeKey(scope: QueryScope) {
  return ['partner', scope.userId, scope.partnerId, scope.permissionRevision] as const;
}
export function partnerKey(
  scope: QueryScope,
  group: ChangeGroup,
  route: string,
  filters: Readonly<Record<string, string | null>> = {},
  generation: string | null = null,
) {
  const normalized = Object.fromEntries(
    Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)),
  );
  return [...scopeKey(scope), group, route, normalized, generation] as const;
}
