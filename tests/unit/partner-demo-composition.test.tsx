import { beforeEach as brandBeforeEach, afterEach as brandAfterEach, vi as brandVi } from 'vitest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { redirectPitchLegacy } from '@/server/platform/pitch-legacy';
import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
import { WithdrawalPreview } from '../../dev/WithdrawalPreview';
import { ContentPreview } from '../../dev/ContentPreview';
import { TransactionsPreview } from '../../dev/TransactionsPreview';
import { browserWithdrawalStorage } from '../../dev/withdrawals/browser-storage';
import { releaseWithdrawalRuntime } from '../../dev/withdrawals/transport';
import { previewScopeFor } from '../../dev/withdrawals/navigation';
import { buildDataset } from '../../dev/demo-dataset/dataset';
import { datasetScope } from '../../dev/demo-dataset/scope';
const demoDatasets = {
  a: buildDataset({ datasetId: 'partner-demo-a', asOf: new Date('2026-09-17T02:00:00Z') }),
  b: buildDataset({ datasetId: 'partner-demo-b', asOf: new Date('2026-09-17T02:00:00Z') }),
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  for (const identity of ['a', 'b'] as const) {
    releaseWithdrawalRuntime(browserWithdrawalStorage, previewScopeFor('partner-demo', identity));
    releaseWithdrawalRuntime(
      browserWithdrawalStorage,
      datasetScope(demoDatasets[identity], identity),
    );
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const identity = new URL(String(input), 'http://localhost').searchParams.get('identity');
      if (identity !== 'a' && identity !== 'b') return new Response(null, { status: 404 });
      return new Response(JSON.stringify(demoDatasets[identity]), { status: 200 });
    }),
  );
  window.history.replaceState({}, '', '/');
});
const url = (href: string) => new URL(href, 'http://localhost');
function nav(name: string) {
  return url(screen.getAllByRole('link', { name })[0].getAttribute('href')!);
}
function expectDemo(href: URL, identity = 'b') {
  expect(href.searchParams.get('scenario')).toBe('partner-demo');
  expect(href.searchParams.get('identity')).toBe(identity);
}

describe('linked partner demo composition', () => {
  it('defaults only the new demo to the open-period window and carries identity through clip detail, account and history', async () => {
    const view = render(<WithdrawalPreview search="scenario=partner-demo&identity=b" />);
    const card = await screen.findByRole('article', { name: 'โปรไฟล์และคอมมิชชัน' });
    expect(within(card).getByText('฿70,000')).toBeVisible();
    const source = url(
      within(card)
        .getByRole('link', { name: /ดูรายละเอียดของรายได้/ })
        .getAttribute('href')!,
    );
    expect(source.pathname).toBe('/content-preview/partner-demo/b');
    expect(source.searchParams.get('toExclusive')).toBe('2026-10-01');
    const topClip = screen
      .getAllByRole('link')
      .find((link) =>
        link.getAttribute('href')?.startsWith('/content-preview/partner-demo/b/clip-'),
      )!;
    const detail = url(topClip.getAttribute('href')!);
    view.unmount();
    render(
      <ContentPreview
        segments={detail.pathname.split('/').slice(2)}
        search={detail.search.slice(1)}
      />,
    );
    const back = url(
      (await screen.findByRole('link', { name: /กลับภาพรวม/ })).getAttribute('href')!,
    );
    expectDemo(back);
    expect(back.searchParams.get('toExclusive')).toBe('2026-10-01');
    const history = nav('Wallet');
    expectDemo(history);
    expect(history.searchParams.get('view')).toBe('withdrawals');
    expectDemo(url(history.searchParams.get('returnTo')!));
    fireEvent.click(screen.getByRole('button', { name: 'เมนูโปรไฟล์' }));
    const account = url(screen.getByRole('link', { name: 'จัดการบัญชี' }).getAttribute('href')!);
    expectDemo(account);
    expect(account.searchParams.get('view')).toBeNull();
    expectDemo(url(account.searchParams.get('returnTo')!));
    expect(screen.queryByText('ตัวอย่างคลิป · ข้อมูลจำลอง')).not.toBeInTheDocument();
  });
  it('preserves an explicit historical window and brand through list filters and history header navigation', async () => {
    const search = 'from=2026-07-01&toExclusive=2026-09-01&brand=Axtion&origin=content';
    const view = render(<ContentPreview segments={['partner-demo', 'a']} search={search} />);
    // The brand remains on the independent thumbnail; inspect its card's detail link.
    const brandLabels = await screen.findAllByText('Axtion', { selector: 'span' });
    for (const brandLabel of brandLabels) {
      const card = brandLabel.closest('article')!;
      const detailLink = within(card).getByRole('link');
      expect(detailLink.querySelector('strong')).toHaveTextContent(/\S/);
      const detail = url(detailLink.getAttribute('href')!);
      expect(detail.pathname).toMatch(/^\/content-preview\/partner-demo\/a\/clip-/);
      expect(detail.searchParams.get('brand')).toBe('Axtion');
      expect(detail.searchParams.get('from')).toBe('2026-07-01');
      expect(detail.searchParams.get('toExclusive')).toBe('2026-09-01');
      expect(within(card).getByRole('button').closest('a')).toBeNull();
    }
    const overview = nav('Overview');
    expectDemo(overview, 'a');
    expect(overview.searchParams.get('brand')).toBe('Axtion');
    expect(overview.searchParams.get('toExclusive')).toBe('2026-09-01');
    const history = nav('Wallet');
    view.unmount();
    render(<TransactionsPreview search={history.search.slice(1)} />);
    await screen.findAllByRole('link', { name: 'My content' });
    const content = nav('My content');
    expect(content.pathname).toBe('/content-preview/partner-demo/a');
    expect(content.searchParams.get('brand')).toBe('Axtion');
    expect(content.searchParams.get('toExclusive')).toBe('2026-09-01');
  });
  it('normalizes retained statement bookmarks to Wallet and ignores the unrelated legacy payment toggle in the linked demo', async () => {
    sessionStorage.setItem('labsd-synthetic-payment-f06', 'paid');
    const returnTo =
      '/withdrawal-preview?scenario=partner-demo&identity=b&from=2026-07-01&toExclusive=2026-10-01';
    render(
      <TransactionsPreview
        segments={['statement-1']}
        search={new URLSearchParams({
          view: 'withdrawals',
          scenario: 'partner-demo',
          identity: 'b',
          returnTo,
        }).toString()}
      />,
    );
    expect(await screen.findAllByText('฿248,600')).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'ใบสรุปงวดเดิม' })).not.toBeInTheDocument();
    expect(nav('Wallet').searchParams.get('view')).toBe('withdrawals');
    expect(screen.queryByText('฿21,840')).not.toBeInTheDocument();
    expect(screen.queryByText(/ใบสรุปงวดเดิมเป็นข้อมูลตัวอย่างแยกต่างหาก/)).not.toBeInTheDocument();
    expect(nav('My content').pathname).toBe('/content-preview/partner-demo/b');
    expectDemo(nav('Overview'));
  });
  it('retains the separate-fixture warning for the original legacy statements', () => {
    render(<TransactionsPreview />);
    expect(screen.getByText(/ใบสรุปงวดเดิมเป็นข้อมูลตัวอย่างแยกต่างหาก/)).toBeVisible();
    expect(nav('My content').pathname).toBe('/content-preview');
  });
});

// Execute the actual server page after TypeScript transpilation, with only its Next notFound and
// dynamic preview-module dependencies substituted. This exercises its real dev-only route guard
// without widening the test runner's aliases or starting a Next server.
const source = readFileSync(
  resolve(process.cwd(), 'app/content-preview/[[...segments]]/page.tsx'),
  'utf8',
);
const require = createRequire(resolve(process.cwd(), 'package.json'));
// esbuild requires Node's matching TextEncoder/Uint8Array realm, not jsdom's mixed globals.
const compiled = execFileSync(
  process.execPath,
  [
    '--input-type=commonjs',
    '-e',
    'process.stdout.write(require("esbuild").transformSync(require("node:fs").readFileSync(0,"utf8"),{loader:"tsx",format:"cjs",target:"es2022",jsx:"automatic"}).code)',
  ],
  { input: source, encoding: 'utf8', cwd: process.cwd() },
).replace('import("@content-preview")', 'Promise.resolve(require("@content-preview"))');
function route(environment = 'development', previewOptIn = '1') {
  const module: {
    exports: {
      default?: (props: {
        params: Promise<{ segments: string[] }>;
        searchParams: Promise<Record<string, string>>;
      }) => Promise<unknown>;
    };
  } = { exports: {} };
  new Function('require', 'module', 'process', compiled)(
    (id: string) => {
      if (id === '@/server/platform/pitch-legacy') return { redirectPitchLegacy };
      if (id === '@/server/platform/development-previews')
        return {
          developmentPreviewsEnabled: () =>
            developmentPreviewsEnabled({
              NODE_ENV: environment as NodeJS.ProcessEnv['NODE_ENV'],
              LABSD_DEVELOPMENT_PREVIEWS_ENABLED: previewOptIn,
            }),
        };
      if (id === 'next/navigation')
        return {
          notFound: () => {
            throw new Error('NOT_FOUND');
          },
        };
      if (id === '@content-preview') return { ContentPreview: () => null };
      return require(id);
    },
    module,
    { env: { NODE_ENV: environment } },
  );
  return module.exports.default!;
}
describe('content preview route prefix guard', () => {
  it('keeps the ordinary development runtime unavailable without opt-in', async () => {
    await expect(
      route(
        'development',
        '0',
      )({ params: Promise.resolve({ segments: [] }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NOT_FOUND');
  });
  it.each([
    [],
    ['clip-1'],
    ['clip-1', 'ads', 'ad-1'],
    ['partner-demo', 'a'],
    ['partner-demo', 'b', 'clip-1'],
    ['partner-demo', 'a', 'clip-1', 'ads', 'ad-1'],
  ])('accepts existing or allowlisted prefixed route %j', async (...segments) => {
    await expect(
      route()({ params: Promise.resolve({ segments }), searchParams: Promise.resolve({}) }),
    ).resolves.toBeTruthy();
  });
  it.each([
    ['partner-demo'],
    ['partner-demo', 'c'],
    ['partner-demo', 'a', 'clip-1', 'bad', 'ad-1'],
    ['partner-demo', 'a', 'clip-1', 'ads', 'ad-1', 'extra'],
    ['partner-demo', 'a', '../x'],
  ])('rejects malformed route %j', async (...segments) => {
    await expect(
      route()({ params: Promise.resolve({ segments }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NOT_FOUND');
  });
  it('keeps the whole route unavailable outside development', async () => {
    await expect(
      route('production')({
        params: Promise.resolve({ segments: ['partner-demo', 'a'] }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NOT_FOUND');
  });
});

// Preserve regression coverage of the opt-in brand-filter capability.
brandBeforeEach(() => brandVi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true'));
brandAfterEach(() => brandVi.unstubAllEnvs());
