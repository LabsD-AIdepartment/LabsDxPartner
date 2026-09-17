import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '@/features/shell/AppShell';
import { PartnerShell } from '@/features/shell/PartnerShell';
import {
  PageHeading,
  DEFAULT_PAGE_HEADING_VISIBILITY,
  type PageHeadingVisibility,
} from '@/features/shell/PageHeading';
import { PageTitleActions } from '@/shared/ui/PageTitleActions';

function visibilityRoot() {
  return screen.getByRole('heading', { level: 1 }).closest('[data-mobile-visible]')!;
}
function expectModes(modes: PageHeadingVisibility) {
  for (const mode of ['mobile', 'tablet', 'desktop'] as const) {
    expect(visibilityRoot()).toHaveAttribute(`data-${mode}-visible`, String(modes[mode]));
  }
}
function CounterAction() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Report action {count}</button>;
}
function WithActions({ visibility }: { visibility?: Partial<PageHeadingVisibility> }) {
  return (
    <AppShell
      active="overview"
      title="Your content"
      accent="Your impact"
      notifications={null}
      headingVisibility={visibility}
    >
      <PageTitleActions>
        <CounterAction />
      </PageTitleActions>
    </AppShell>
  );
}

describe('responsive page heading contract', () => {
  it('keeps one semantic heading and centralizes mobile-off/tablet-on/desktop-on defaults', () => {
    render(<PageHeading title="Your content" accent="Your impact" subtitle="Selected report" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Your content Your impact' })).toBeInTheDocument();
    expect(visibilityRoot()).toContainElement(screen.getByText('Selected report'));
    expectModes({ mobile: false, tablet: true, desktop: true });
  });

  it.each([
    ['mobile', true],
    ['tablet', false],
    ['desktop', false],
  ] as const)(
    'changes only the %s mode and restores omitted defaults on rerender',
    (mode, value) => {
      const view = render(<PageHeading title="Title" accent="Accent" />);
      view.rerender(<PageHeading title="Title" accent="Accent" visibility={{ [mode]: value }} />);
      expectModes({ ...DEFAULT_PAGE_HEADING_VISIBILITY, [mode]: value });
      view.rerender(
        <PageHeading title="Title" accent="Accent" visibility={{ [mode]: undefined }} />,
      );
      expectModes({ mobile: false, tablet: true, desktop: true });
      expect(DEFAULT_PAGE_HEADING_VISIBILITY).toEqual({
        mobile: false,
        tablet: true,
        desktop: true,
      });
    },
  );

  it.each([
    ['overview', 'Your content Your impact'],
    ['content', 'Create Share Get rewarded'],
    ['transactions', 'Your earnings Made clear'],
    [null, 'Your account Your partnership'],
  ] as const)('applies defaults to shared %s pages without duplicate headings', (active, name) => {
    render(
      <PartnerShell active={active}>
        <p>Page content</p>
      </PartnerShell>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expectModes({ mobile: false, tablet: true, desktop: true });
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('forwards PartnerShell overrides and preserves live portal actions across visibility changes', () => {
    const partner = render(
      <PartnerShell active="content" headingVisibility={{ mobile: true, tablet: false }}>
        <p>Content</p>
      </PartnerShell>,
    );
    expectModes({ mobile: true, tablet: false, desktop: true });
    partner.unmount();
    const view = render(
      <WithActions visibility={{ mobile: false, tablet: false, desktop: false }} />,
    );
    const action = screen.getByRole('button', { name: 'Report action 0' });
    const row = screen.getByRole('heading', { level: 1 }).parentElement!;
    expect(row).toContainElement(action);
    fireEvent.click(action);
    expect(screen.getByRole('button', { name: 'Report action 1' })).toBeEnabled();
    view.rerender(<WithActions visibility={{ mobile: true }} />);
    expectModes({ mobile: true, tablet: true, desktop: true });
    expect(screen.getByRole('button', { name: 'Report action 1' })).toBe(action);
    fireEvent.click(action);
    expect(screen.getByRole('button', { name: 'Report action 2' })).toBeEnabled();
  });
});
