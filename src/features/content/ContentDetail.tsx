'use client';
import { formatExactDecimal } from '@/contracts/platform-metrics';
import { getAdOrderSummary } from './ad-order-summary';
import { ShopVideoPanel } from '@/features/shop-video/ShopVideoPanel';
import { ActionArrow } from '@/shared/ui/ActionArrow';
import { useContext, useState } from 'react';
import { PageTitleActions, PageTitleActionsTarget } from '@/shared/ui/PageTitleActions';
import { useMobileHeaderActions } from '@/shared/ui/MobileHeaderActions';
import { Card } from '@/shared/ui/Card';
import { CoverImage } from '@/shared/ui/CoverImage';
import { Money } from '@/shared/ui/Money';
import { BackLink } from '@/shared/ui/BackLink';
import { LinkButton } from '@/shared/ui/LinkButton';
import { DataState } from '@/shared/ui/DataState';
import { reportHref, validContentFilters } from '@/shared/routing/report-context';
import { dateLabel } from '@/shared/ui/format-date';
import { useContent } from './useContent';
import { ContentState, DataEnvelope } from './ContentState';
import { MetricSections } from './MetricDefinition';
import { EarningsSection } from './EarningsSection';
import { AdList } from './AdList';
import { AdPerformance } from './AdPerformance';
import type { ContentProps } from './types';
import { Text } from '@/shared/ui/Text';
import styles from './content.module.css';
export function ContentDetail(props: ContentProps & { contentId: string }) {
  const { context: c, routes } = props;
  const mobilePlacement = useMobileHeaderActions();
  const titleTarget = useContext(PageTitleActionsTarget);
  const hasTitleBack = !!titleTarget && !mobilePlacement?.mobile;
  const query = useContent(props.transport, {
    scope: props.scope,
    context: c,
    resource: 'detail',
    contentId: props.contentId,
  });
  const [earningsOpen, setEarningsOpen] = useState(false),
    [adsOpen, setAdsOpen] = useState(false),
    [metricsOpen, setMetricsOpen] = useState(false);
  const data = query.data;
  const back = c.origin === 'overview' ? routes.overview : routes.content;
  const pinned = data ? { ...c, generation: data.generation } : c;
  const detail = data?.data;
  const adSummary = data ? getAdOrderSummary(detail?.performance, data.period) : null;
  const mapped = detail?.attribution === 'content';
  const unmatched = detail?.attribution === 'partner-only';
  const unavailableIncome =
    detail?.content.unavailableReason ?? 'ยังไม่มีข้อมูลรายได้ในช่วงที่เลือก';
  const hasDetailCard = !!data && !!detail && !query.error && data.dataState !== 'unavailable';
  const backLabel = c.origin === 'overview' ? 'กลับภาพรวม' : 'กลับคลังคลิป';
  const backHref = reportHref(back, c);
  const libraryHref = reportHref(routes.content, { ...c, origin: 'content' });
  const hasVideoSource = !detail?.content.removed && !!props.shopVideoTransport;
  const navigation = (
    <div className={`${styles.back} ${hasDetailCard ? styles.detailBackOutside : ''}`}>
      <BackLink href={backHref} label={backLabel} />
      {c.origin === 'overview' && <LinkButton href={libraryHref}>ดูคลิปทั้งหมด</LinkButton>}
    </div>
  );
  return (
    <div
      className={`${styles.page} ${hasDetailCard ? styles.detailPageReady : ''} ${hasTitleBack ? styles.detailPageHeaderBack : ''}`}
    >
      {mobilePlacement?.mobile ? (
        navigation
      ) : (
        <PageTitleActions fallbackClassName={hasDetailCard ? styles.detailBackOutside : undefined}>
          {navigation}
        </PageTitleActions>
      )}
      {!validContentFilters(c) ? (
        <DataState state="error" message="ช่วงเวลาหรือรุ่นข้อมูลไม่ถูกต้อง กรุณากลับคลังคลิป" />
      ) : (
        <ContentState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
          latestHref={reportHref(routes.overview, { ...c, generation: null })}
        />
      )}
      {data && detail && !query.error && (
        <DataEnvelope data={data} showFreshness={false}>
          <Card className={styles.detailClipCard}>
            <BackLink
              href={backHref}
              label={backLabel}
              mobileOnly
              className={styles.detailMobileBack}
            />
            <div className={styles.detailHero}>
              <div className={styles.detailCover}>
                <CoverImage
                  className={styles.cover}
                  src={detail.content.removed ? null : detail.content.cover}
                  alt={detail.content.removed ? 'คลิปถูกนำออกแล้ว' : detail.content.title}
                  style={{ objectPosition: detail.content.coverPosition }}
                />
              </div>
              <div className={styles.detailSummary}>
                <Text variant="caption" tone="muted" className={styles.meta}>
                  {detail.content.brand} · เผยแพร่ {dateLabel(detail.content.publishedAt)}
                </Text>
                <h2>{detail.content.title}</h2>
                {detail.content.removed && (
                  <p className={styles.notice}>
                    คลิปถูกนำออกแล้ว ประวัติรายได้ที่ตรวจสอบได้ยังแสดงอยู่
                  </p>
                )}
                {!mapped && (
                  <DataState
                    state="partial"
                    message={
                      unmatched
                        ? 'ต้นทางระบุรายได้ระดับพาร์ทเนอร์ ยังจับคู่กับคลิปนี้ไม่ได้ จึงยังแสดงรายได้รายคลิปไม่ได้'
                        : unavailableIncome
                    }
                  />
                )}
                <div className={styles.kpis}>
                  <div>
                    <span>ยอดขายจากโฆษณา</span>
                    <strong
                      aria-label={
                        adSummary?.sales === null ? (adSummary.salesReason ?? undefined) : undefined
                      }
                    >
                      {adSummary?.sales != null && adSummary.salesCurrency
                        ? (adSummary.salesCurrency === 'THB'
                            ? '฿'
                            : adSummary.salesCurrency + ' ') +
                          formatExactDecimal(adSummary.sales, 2)
                        : '—'}
                    </strong>
                    {adSummary?.sales === null && <small>{adSummary.salesReason}</small>}
                  </div>
                  <div>
                    <span>คอมมิชชันจากยอดขาย</span>
                    <Money
                      value={mapped ? detail.content.earned : null}
                      reason={detail.content.unavailableReason ?? undefined}
                    />
                  </div>
                  <div>
                    <span>ออเดอร์จากโฆษณา</span>
                    <strong
                      aria-label={
                        adSummary?.orders === null
                          ? (adSummary.ordersReason ?? undefined)
                          : undefined
                      }
                    >
                      {adSummary?.orders != null ? formatExactDecimal(adSummary.orders, 0) : '—'}
                    </strong>
                    {adSummary?.orders === null && <small>{adSummary.ordersReason}</small>}
                  </div>
                  <div>
                    <span>AOV จากโฆษณา</span>
                    <strong
                      aria-label={
                        adSummary?.aov === null ? (adSummary.aovReason ?? undefined) : undefined
                      }
                    >
                      {adSummary?.aov != null && adSummary.currency
                        ? (adSummary.currency === 'THB' ? '฿' : adSummary.currency + ' ') +
                          formatExactDecimal(adSummary.aov, 2)
                        : '—'}
                    </strong>
                    {adSummary?.aov === null && <small>{adSummary.aovReason}</small>}
                  </div>
                </div>
                {adSummary?.stale &&
                  (adSummary.sales !== null ||
                    adSummary.orders !== null ||
                    adSummary.aov !== null) && (
                    <Text variant="caption" tone="muted">
                      ผลโฆษณาล่าสุดที่บันทึกไว้
                    </Text>
                  )}
                {detail.sourceUrl && !detail.content.removed && (
                  <LinkButton href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">
                    เปิดคลิปต้นฉบับ <ActionArrow />
                  </LinkButton>
                )}
              </div>
            </div>
            {c.origin === 'overview' && (
              <div className={styles.detailMobileLibrary}>
                <LinkButton href={libraryHref}>ดูคลิปทั้งหมด</LinkButton>
              </div>
            )}
          </Card>
          <Card>
            <details
              className={styles.disclosure}
              onToggle={(e) => setEarningsOpen(e.currentTarget.open)}
            >
              <summary>รายได้และวิธีคำนวณ</summary>
              {earningsOpen &&
                (mapped ? (
                  <EarningsSection {...props} context={pinned} />
                ) : (
                  <DataState
                    state="partial"
                    message={
                      unmatched
                        ? 'ยังไม่สามารถแสดงรายการฐานยอดขายหรืออัตราของคลิปนี้ จนกว่าจะมีหลักฐานจับคู่จากต้นทาง'
                        : unavailableIncome
                    }
                  />
                ))}
            </details>
          </Card>
          <Card title={detail.performance ? 'ผลโฆษณาที่ใช้คลิปนี้' : undefined}>
            {detail.performance ? (
              <>
                <AdPerformance
                  performance={detail.performance}
                  canViewAdSpend={props.canViewAdSpend}
                />
                {hasVideoSource && props.shopVideoTransport && (
                  <details
                    className={styles.performanceDefinition}
                    onToggle={(e) => setMetricsOpen(e.currentTarget.open)}
                  >
                    <summary>ผลการขายจาก TikTok Shop Video</summary>
                    {metricsOpen && (
                      <ShopVideoPanel
                        scope={props.scope}
                        clipId={props.contentId}
                        from={c.from}
                        toExclusive={c.toExclusive}
                        transport={props.shopVideoTransport}
                      />
                    )}
                  </details>
                )}
              </>
            ) : (
              <details
                className={styles.disclosure}
                onToggle={(e) => setMetricsOpen(e.currentTarget.open)}
              >
                <summary>ประสิทธิภาพคลิป</summary>
                <MetricSections
                  metrics={detail.metrics}
                  canViewAdSpend={props.canViewAdSpend}
                  showEmpty={!hasVideoSource}
                />
                {metricsOpen && hasVideoSource && props.shopVideoTransport && (
                  <ShopVideoPanel
                    scope={props.scope}
                    clipId={props.contentId}
                    from={c.from}
                    toExclusive={c.toExclusive}
                    transport={props.shopVideoTransport}
                  />
                )}
              </details>
            )}
          </Card>
          <Card>
            <details
              className={styles.disclosure}
              onToggle={(e) => setAdsOpen(e.currentTarget.open)}
            >
              <summary>
                โฆษณาที่ใช้คลิปนี้{detail.adCount === null ? '' : ` (${detail.adCount})`}
              </summary>
              {adsOpen && <AdList {...props} context={pinned} />}
            </details>
          </Card>
        </DataEnvelope>
      )}
    </div>
  );
}
