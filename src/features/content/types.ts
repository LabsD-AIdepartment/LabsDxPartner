import type { QueryScope } from '@/shared/query/keys';
import type { ReportContext } from '@/shared/routing/report-context';
import type { ContentTransport } from './model';
export type ContentProps = {
  scope: QueryScope;
  transport: ContentTransport;
  context: ReportContext;
  routes: { content: string; overview: string };
  canViewAdSpend: boolean;
};
