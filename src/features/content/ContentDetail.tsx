'use client';
import { useState } from 'react';
import { Card } from '@/shared/ui/Card';
import { CoverImage } from '@/shared/ui/CoverImage';
import { Money } from '@/shared/ui/Money';
import { LinkButton } from '@/shared/ui/LinkButton';
import { DataState } from '@/shared/ui/DataState';
import { reportHref, validContentFilters } from '@/shared/routing/report-context';
import { dateLabel } from '@/shared/ui/format-date';
import { useContent } from './useContent';
import { ContentState, DataEnvelope } from './ContentState';
import { MetricSections } from './MetricDefinition';
import { EarningsSection } from './EarningsSection';
import { AdList } from './AdList';
import type { ContentProps } from './types';
import { Text } from '@/shared/ui/Text';
import styles from './content.module.css';
export function ContentDetail(props: ContentProps & { contentId: string }) {
  const { context: c, routes } = props;
  const query = useContent(props.transport, {
    scope: props.scope,
    context: c,
    resource: 'detail',
    contentId: props.contentId,
  });
  const [earningsOpen, setEarningsOpen] = useState(false),
    [adsOpen, setAdsOpen] = useState(false);
  const data = query.data;
  const back = c.origin === 'overview' ? routes.overview : routes.content;
  const pinned = data ? { ...c, generation: data.generation } : c;
  const detail = data?.data;
  const mapped = detail?.attribution === 'content';
  return (
    <div className={styles.page}>
      <div className={styles.back}>
        <LinkButton href={reportHref(back, c)}>
          ← {c.origin === 'overview' ? 'กลับภาพรวม' : 'กลับคลังคลิป'}
        </LinkButton>
        {c.origin === 'overview' && (
          <LinkButton href={reportHref(routes.content, { ...c, origin: 'content' })}>
            ดูคลิปทั้งหมด
          </LinkButton>
        )}
      </div>
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
        <DataEnvelope data={data}>
          <Card>
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
                      detail.attribution === 'partner-only'
                        ? 'ต้นทางระบุรายได้ระดับพาร์ทเนอร์ ยังจับคู่กับคลิปนี้ไม่ได้ จึงยังแสดงรายได้รายคลิปไม่ได้'
                        : 'ยังไม่มีหลักฐานที่มาของรายได้คลิปนี้'
                    }
                  />
                )}
                <div className={styles.kpis}>
                  <div>
                    <span>คอมมิชชันในช่วงที่เลือก</span>
                    <Money
                      value={mapped ? detail.content.earned : null}
                      reason={detail.content.unavailableReason ?? undefined}
                    />
                  </div>
                  <div>
                    <span>ยอดขายเข้าเงื่อนไข</span>
                    <Money value={mapped ? detail.eligibleSales : null} />
                  </div>
                  <div>
                    <span>ออเดอร์เข้าเงื่อนไข</span>
                    <strong>
                      {mapped && detail.eligibleOrders !== null
                        ? new Intl.NumberFormat('th-TH').format(detail.eligibleOrders)
                        : '—'}
                    </strong>
                    {detail.eligibleOrders === null && <small>ต้นทางยังไม่ส่งจำนวนออเดอร์</small>}
                  </div>
                  <div>
                    <span>สถานะรายได้</span>
                    <strong className={styles.status}>
                      {mapped
                        ? {
                            confirmed: 'ยืนยันแล้ว',
                            estimated: 'ประมาณการ',
                            mixed: 'มีทั้งยืนยันและประมาณการ',
                            unavailable: 'ยังไม่มีข้อมูลสถานะ',
                          }[detail.earningsStatus]
                        : 'ยังจับคู่ไม่ได้'}
                    </strong>
                  </div>
                </div>
                <Text variant="caption" tone="muted" className={styles.meta}>
                  ยอดของคลิปนี้ ไม่ใช่ยอดโอน และไม่รวมผลลัพธ์ที่แพลตฟอร์มนับแยกต่างหาก
                </Text>
                {detail.sourceUrl && !detail.content.removed && (
                  <LinkButton href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">
                    เปิดคลิปต้นฉบับ ↗
                  </LinkButton>
                )}
              </div>
            </div>
          </Card>
          <Card>
            <details
              className={styles.disclosure}
              onToggle={(e) => setEarningsOpen(e.currentTarget.open)}
            >
              <summary>รายได้และวิธีคำนวณ</summary>
              <Text variant="caption" tone="muted" className={styles.meta}>
                เวอร์ชันข้อตกลง {detail.agreementVersion ?? 'ยังไม่มีข้อมูล'}
              </Text>
              {earningsOpen &&
                (mapped ? (
                  <EarningsSection {...props} context={pinned} />
                ) : (
                  <DataState
                    state="partial"
                    message="ยังไม่สามารถแสดงรายการฐานยอดขายหรืออัตราของคลิปนี้ จนกว่าจะมีหลักฐานจับคู่จากต้นทาง"
                  />
                ))}
            </details>
          </Card>
          <Card>
            <details className={styles.disclosure}>
              <summary>ประสิทธิภาพคลิป</summary>
              <MetricSections metrics={detail.metrics} canViewAdSpend={props.canViewAdSpend} />
            </details>
          </Card>
          <Card>
            <details
              className={styles.disclosure}
              onToggle={(e) => setAdsOpen(e.currentTarget.open)}
            >
              <summary>โฆษณาที่ใช้คลิปนี้ ({detail.adCount})</summary>
              {adsOpen && <AdList {...props} context={pinned} />}
            </details>
          </Card>
        </DataEnvelope>
      )}
    </div>
  );
}
