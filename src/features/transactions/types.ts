import type { QueryScope } from '@/shared/query/keys';
import type { TransactionTransport, DocumentTransport } from './model';
export type TransactionsProps = {
  scope: QueryScope;
  transport: TransactionTransport;
  documents: DocumentTransport;
  basePath: string;
  returnTo: string;
  supportUrl?: string;
};
