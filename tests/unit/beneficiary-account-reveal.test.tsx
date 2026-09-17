import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PayoutBeneficiaryValue } from '@/contracts/withdrawal-journey';
import {
  BeneficiaryAccountRevealProvider,
  useBeneficiaryAccountNumber,
  useBeneficiaryRevealIdentityKey,
  type BeneficiaryAccountRevealEntry,
} from '@/features/withdrawals/BeneficiaryAccountRevealContext';

const ENTRY: BeneficiaryAccountRevealEntry = {
  displayName: 'บริษัท ตัวอย่าง จำกัด',
  bankName: 'ธนาคารกสิกรไทย',
  maskedAccount: 'XXX-X-X1234-5',
  version: 'ben-v1-b0-c0',
  fullAccount: '1234512345',
};

const known = (over: Partial<Record<string, string>> = {}): PayoutBeneficiaryValue =>
  ({
    state: 'known',
    displayName: ENTRY.displayName,
    bankName: ENTRY.bankName,
    maskedAccount: ENTRY.maskedAccount,
    version: ENTRY.version,
    ...over,
  }) as PayoutBeneficiaryValue;

function Probe({ beneficiary }: { beneficiary: PayoutBeneficiaryValue }) {
  const full = useBeneficiaryAccountNumber(beneficiary);
  const key = useBeneficiaryRevealIdentityKey();
  return (
    <div>
      <span data-testid="full">{full ?? 'none'}</span>
      <span data-testid="key">{key ?? 'nokey'}</span>
    </div>
  );
}

const renderWithProvider = (
  beneficiary: PayoutBeneficiaryValue,
  entries: BeneficiaryAccountRevealEntry[],
  identityKey = 'id-1',
) =>
  render(
    <BeneficiaryAccountRevealProvider identityKey={identityKey} entries={entries}>
      <Probe beneficiary={beneficiary} />
    </BeneficiaryAccountRevealProvider>,
  );

describe('beneficiary account reveal', () => {
  it('returns null with no provider (fail-closed) and no identity key', () => {
    render(<Probe beneficiary={known()} />);
    expect(screen.getByTestId('full')).toHaveTextContent('none');
    expect(screen.getByTestId('key')).toHaveTextContent('nokey');
  });

  it('reveals the full number only for an exact four-field + version match', () => {
    renderWithProvider(known(), [ENTRY]);
    expect(screen.getByTestId('full')).toHaveTextContent('1234512345');
    expect(screen.getByTestId('key')).toHaveTextContent('id-1');
  });

  it('never reveals for missing or pending beneficiaries', () => {
    renderWithProvider({ state: 'missing', reasons: ['x'] }, [ENTRY]);
    expect(screen.getByTestId('full')).toHaveTextContent('none');
    renderWithProvider({ state: 'pending', version: ENTRY.version, reasons: ['x'] }, [ENTRY]);
    expect(screen.getAllByTestId('full')[1]).toHaveTextContent('none');
  });

  it('re-masks (null) when the beneficiary version bumps (e.g. a config edit)', () => {
    renderWithProvider(known({ version: 'ben-v1-b1-c0' }), [ENTRY]);
    expect(screen.getByTestId('full')).toHaveTextContent('none');
  });

  it('re-masks when any masked identity field diverges from the entry', () => {
    renderWithProvider(known({ bankName: 'ธนาคารอื่น' }), [ENTRY]);
    expect(screen.getByTestId('full')).toHaveTextContent('none');
  });

  it('collapses duplicate identical entries (a/b same seed) to one number', () => {
    renderWithProvider(known(), [ENTRY, { ...ENTRY }]);
    expect(screen.getByTestId('full')).toHaveTextContent('1234512345');
  });

  it('is ambiguous → null when two matching entries disagree on the number', () => {
    renderWithProvider(known(), [ENTRY, { ...ENTRY, fullAccount: '9999999999' }]);
    expect(screen.getByTestId('full')).toHaveTextContent('none');
  });

  it('exposes an empty-entry provider with no reveal', () => {
    renderWithProvider(known(), []);
    expect(screen.getByTestId('full')).toHaveTextContent('none');
    expect(screen.getByTestId('key')).toHaveTextContent('id-1');
  });

  it('refreshes to the exact current tuple (and drops the superseded one) on a same-identityKey rerender when fields contain the legacy delimiter', () => {
    // Regression: entry fields are unrestricted strings. A naive delimiter-join content signature
    // collapses these two DISTINCT tuples to the SAME string — the '␟' separator is merely
    // redistributed between displayName and bankName — so a same-identityKey rerender would freeze
    // the STALE first memo and never surface the current entry. JSON.stringify quotes/escapes every
    // field, keeping the signatures distinct so the memo refreshes.
    const SEP = '␟';
    const shared = {
      maskedAccount: ENTRY.maskedAccount,
      version: ENTRY.version,
      fullAccount: '999999',
    };
    const entryA: BeneficiaryAccountRevealEntry = {
      displayName: `ACME${SEP}BANK`,
      bankName: 'X',
      ...shared,
    };
    const entryB: BeneficiaryAccountRevealEntry = {
      displayName: 'ACME',
      bankName: `BANK${SEP}X`,
      ...shared,
    };
    // A delimiter-join of the whole tuple is byte-identical for entryA and entryB (collision).
    const benB = known({ displayName: entryB.displayName, bankName: entryB.bankName });
    const benA = known({ displayName: entryA.displayName, bankName: entryA.bankName });

    const tree = (entries: BeneficiaryAccountRevealEntry[]) => (
      <BeneficiaryAccountRevealProvider identityKey="id-stable" entries={entries}>
        <Probe beneficiary={benB} />
        <Probe beneficiary={benA} />
      </BeneficiaryAccountRevealProvider>
    );

    const view = render(tree([entryA]));
    // Only entryA is present at first: benA reveals, the not-yet-supplied benB does not.
    expect(screen.getAllByTestId('full')[0]).toHaveTextContent('none'); // benB (current tuple)
    expect(screen.getAllByTestId('full')[1]).toHaveTextContent('999999'); // benA (old tuple)

    view.rerender(tree([entryB]));
    // The signature MUST change even though a delimiter-join would collide: benB (the exact current
    // tuple) now resolves and benA (superseded) re-masks. A collision signature would have kept the
    // stale entryA memo, leaving benB masked and benA wrongly revealed.
    expect(screen.getAllByTestId('full')[0]).toHaveTextContent('999999'); // benB resolves
    expect(screen.getAllByTestId('full')[1]).toHaveTextContent('none'); // benA must not resolve
  });
});
