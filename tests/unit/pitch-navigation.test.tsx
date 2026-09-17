import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { pitchHref, pitchSearch } from '@/features/pitch/routes';
import { ApplicationPresentationContext } from '@/shared/routing/ApplicationPresentation';
import { PreviewTools } from '../../dev/PreviewTools';
import AppLink from '@/shared/ui/AppLink';

describe('canonical pitch navigation', () => {
  it.each([
    ['/withdrawal-preview?scenario=partner-demo&identity=a','/overview'],
    ['/content-preview/partner-demo/a/clip-3?origin=overview','/content/clip-3?origin=overview'],
    ['/transactions-preview?view=withdrawals&request=202609141005','/transactions?view=withdrawals&request=202609141005'],
    ['/account-preview?view=payout','/account?view=payout'],
  ])('maps %s onto the main application', (before,after) => expect(pitchHref(before)).toBe(after));
  it('preserves bounded nested return navigation and does not rewrite external URLs', () => {
    const value=pitchHref('/transactions-preview?returnTo=%2Fwithdrawal-preview%3Fidentity%3Da');
    expect(new URL(value,'https://example.invalid').searchParams.get('returnTo')).toBe('/overview');
    expect(pitchHref('https://external.invalid/withdrawal-preview')).toBe('https://external.invalid/withdrawal-preview');
  });
  it('pins sample selection and accepted default window regardless of URL overrides', () => {
    const params=new URLSearchParams(pitchSearch({identity:'b',scenario:'empty',devtools:'1'}));
    expect(params.get('identity')).toBe('a'); expect(params.get('scenario')).toBe('partner-demo');
    expect(params.has('devtools')).toBe(false); expect(params.get('from')).toBe('2026-07-01');
    expect(params.get('toExclusive')).toBe('2026-09-01');
  });
  it('suppresses all preview controls in pitch even when the URL asks for devtools', () => {
    window.history.replaceState({},'', '/overview?devtools=1');
    render(<ApplicationPresentationContext.Provider value={{resolveHref:pitchHref,sampleData:true}}><PreviewTools><button>Reset simulation</button></PreviewTools><AppLink href="/withdrawal-preview">Overview</AppLink></ApplicationPresentationContext.Provider>);
    expect(screen.queryByRole('button',{name:'Reset simulation'})).toBeNull();
    expect(screen.getByRole('link',{name:'Overview'})).toHaveAttribute('href','/overview');
  });
});
