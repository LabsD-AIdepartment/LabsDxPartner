export type PartnerScreen =
  | { kind: 'overview' | 'content' | 'transactions' | 'account' }
  | { kind: 'clip'; contentId: string }
  | { kind: 'ad'; contentId: string; adId: string }
  | { kind: 'statement'; statementId: string };
