'use client';
import { useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Sparkles, Wallet, Video } from 'lucide-react';
import { AppShell } from '@/features/shell/AppShell';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { MusicToggle } from '@/features/shell/MusicToggle';
import { type Menu } from '@/features/shell/Navigation';
import { CoverImage } from '@/shared/ui/CoverImage';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { Money } from '@/shared/ui/Money';
import { Dialog } from '@/shared/ui/Dialog';
import { Sheet } from '@/shared/ui/Sheet';
import { StatusBadge, type Status } from '@/shared/ui/StatusBadge';
import { DataState } from '@/shared/ui/DataState';
import { FilterBar, type FilterValue } from '@/shared/ui/FilterBar';
import { TrendChart } from '@/shared/charts/TrendChart';
import { BarChart } from '@/shared/charts/BarChart';
import { DonutChart } from '@/shared/charts/DonutChart';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { ChangeWatcher } from '@/shared/query/ChangeWatcher';
import { scenario, scenarioNames, type ScenarioName } from './scenarios';
import { money } from './scenarios/ready';
import type { ChangesValue } from '@/contracts/changes';
import styles from './gallery.module.css';
const scope = { userId: 'user-1', partnerId: 'partner-1', permissionRevision: '1' };
const defaultFilter = { from: '2026-07-01', toExclusive: '2026-09-01', brand: null };
export function FoundationGallery() {
  return (
    <ScopedQueryProvider scope={scope}>
      <Gallery />
    </ScopedQueryProvider>
  );
}
function Gallery() {
  const [name, setName] = useState<ScenarioName>('ready');
  const [active, setActive] = useState<Menu>('overview');
  const s = useMemo(() => scenario(name), [name]);
  const [filter, setFilter] = useState<FilterValue>(defaultFilter);
  const [dialog, setDialog] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [seen, setSeen] = useState(false);
  const [changed, setChanged] = useState('ยังไม่มีการเปลี่ยนแปลง');
  const revision = useRef<ChangesValue>(s.changes);
  const notifications = {
    ...s.notifications,
    unseenCount: seen ? 0 : s.notifications.unseenCount,
    items: s.notifications.items.map((x) => ({ ...x, seen: seen || x.seen })),
  };
  const filtered = s.content.data.items.filter((x) => !filter.brand || x.brand === filter.brand);
  const headings = {
    overview: ['Your content', 'Your impact'],
    content: ['Create Share', 'Get rewarded'],
    transactions: ['Your earnings', 'All clear'],
  };
  return (
    <AppShell
      footerNote="ตัวอย่างส่วนประกอบ · ข้อมูลจำลองเพื่อพัฒนาเท่านั้น"
      active={active}
      onNavigate={setActive}
      title={headings[active][0]}
      accent={headings[active][1]}
      subtitle="ทุกคอนเทนต์มีคุณค่า ติดตามยอดขายและคอมมิชชันของคุณได้ที่เดียว"
      avatar="/media/celebrity-avatar.png"
      notifications={
        <NotificationButton
          data={notifications}
          onSeen={() => setSeen(true)}
          onOpenStatement={() => setSheet(true)}
        />
      }
    >
      <ChangeWatcher
        scope={scope}
        load={async () => ({ ...revision.current })}
        onAccessLost={() => setChanged('สิทธิ์เปลี่ยนแปลง')}
        onChange={(groups) => setChanged(`ข้อมูลที่เปลี่ยน: ${groups.join(', ')}`)}
      />
      <div className={styles.tools}>
        <div className={styles.welcome}>
          สวัสดี คุณมดดำ <Sparkles className={styles.spark} size={18} /> นี่คือผลงานของคุณ
        </div>
        <FilterBar
          value={filter}
          brands={['Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova']}
          onChange={setFilter}
          onReset={() => setFilter(defaultFilter)}
          onExport={() => setDialog('Export report')}
        />
      </div>
      <DataState state={s.overview.dataState} message={s.overview.reasons[0]} />
      <p className={styles.galleryLabel}>
        Component preview · ข้อมูลจำลองสำหรับตรวจส่วนประกอบ ยังไม่ใช่หน้ารายงานจริง
      </p>
      {active === 'overview' && (
        <>
          <div className={styles.bento}>
            <Card className={styles.profile}>
              <div className={styles.portrait}>
                <img src="/media/celebrity-thumbnail.png" alt="มดดำ คชาภา" />
                <div className={styles.identity}>
                  <img src="/media/celebrity-avatar.png" alt="" />
                  <div>
                    <strong>มดดำ คชาภา</strong>
                    <span>Celebrity partner</span>
                  </div>
                </div>
              </div>
              <div className={styles.profileBody}>
                <h2>คอมมิชชันของฉัน</h2>
                <p className="muted small">ยอดยืนยันแล้ว · ช่วงเวลาตัวอย่าง</p>
                <Money
                  value={s.overview.earnings.confirmed}
                  className={`${styles.figure} ${styles.profileFigure}`}
                />
                <div className={styles.divider} />
                <div className={styles.breakdown}>
                  <div>
                    <p>● ยืนยันแล้ว</p>
                    <Money value={s.overview.earnings.confirmed} />
                  </div>
                  <div>
                    <p>ประมาณการ</p>
                    <Money value={s.overview.earnings.estimated} />
                  </div>
                </div>
                <div className={styles.divider} />
                <Button onClick={() => setDialog('วิธีคิดคอมมิชชัน')}>
                  ดูวิธีคิดคอมมิชชัน <ArrowUpRight size={16} />
                </Button>
              </div>
            </Card>
            <Card title="Sales in motion" description="ยอดขายจากคลิปของคุณ">
              <Money value={s.overview.earnings.eligibleSales} className={styles.figure} />
              <BarChart
                items={
                  name === 'empty'
                    ? []
                    : [
                        { label: 'Axtion', value: money('15920000') },
                        { label: 'Tendrix', value: money('9600000') },
                        { label: 'Rusiren', value: money('2580000') },
                        { label: 'Melura', value: money('7400000') },
                        { label: 'Zenova', value: money('1860000') },
                      ]
                }
              />
              <div className={styles.divider} />
              <span className="muted small">แยกตามแบรนด์</span>
            </Card>
            <Card className={styles.payout} title="Your next payout" action={<Wallet size={18} />}>
              <div className={styles.statuses}>
                <StatusBadge status="pending" />
              </div>
              <Money
                value={s.overview.obligation.nextPayout?.amount ?? null}
                className={styles.figure}
              />
              <p className="muted small">ยอดคอมมิชชันตามรอบจ่าย</p>
              <div className={styles.progress}>
                <i />
                <i />
                <i />
              </div>
              <div className={styles.progressLabels}>
                <span>บันทึกยอด</span>
                <span>ยืนยันยอด</span>
                <span>โอนเงิน</span>
              </div>
              <Button variant="primary" onClick={() => setSheet(true)}>
                ดูรายการจ่ายเงิน <ArrowUpRight size={18} />
              </Button>
            </Card>
            <Card
              className={styles.trend}
              title="Every clip counts"
              description="คอมมิชชันจากคอนเทนต์ของคุณ"
              action={<span className="muted small">THB</span>}
            >
              <div className={styles.inline}>
                <Money value={s.overview.earnings.confirmed} className={styles.figure} />
                <span className="small muted">
                  <Video size={14} /> {s.earnings.data.items.length} รายการ
                </span>
              </div>
              <TrendChart points={s.overview.earnings.trend} />
            </Card>
          </div>
          <div className={styles.lower}>
            <Card
              title="Small clips Real results"
              description="คลิปที่สร้างคอมมิชชันสูงสุด"
              action={
                <Button onClick={() => setActive('content')}>
                  ดูทั้งหมด <ArrowUpRight size={16} />
                </Button>
              }
            >
              {s.overview.earnings.topContent.map((x) => (
                <button className={styles.clipRow} key={x.id} onClick={() => setDialog(x.title)}>
                  <CoverImage src={x.cover} alt="" />
                  <div className={styles.clipText}>
                    <p>{x.title}</p>
                    <small>{x.brand} · Organic</small>
                  </div>
                  <strong>
                    <Money value={x.earned} />
                  </strong>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </Card>
            <Card title="Your earning mix" action={<Sparkles size={18} />}>
              <DonutChart
                primary={name === 'empty' ? '0' : '2980000'}
                total={name === 'empty' ? '0' : '3736000'}
              />
            </Card>
          </div>
        </>
      )}
      {active === 'content' && (
        <Card title="Your content library" description="ตัวอย่างการ์ดคลิปและอัตราส่วนภาพ">
          <div className={styles.library}>
            {filtered.map((x) => (
              <Card key={x.id}>
                <CoverImage
                  className={styles.cover}
                  src={x.cover}
                  style={{ objectPosition: x.coverPosition }}
                  alt={x.title}
                  loading="lazy"
                />
                <h3 className={styles.tileTitle}>{x.title}</h3>
                <p className="small muted">
                  {x.brand} · {x.publishedAt.slice(0, 10)}
                </p>
                <div className={styles.earnPanel}>
                  <span>คอมมิชชัน</span>
                  <Money value={x.earned} />
                </div>
                <Button onClick={() => setDialog(x.title)}>
                  ดูรายละเอียด <ArrowUpRight size={16} />
                </Button>
              </Card>
            ))}
          </div>
          <DataState state={filtered.length ? 'ready' : 'empty'} />
        </Card>
      )}
      {active === 'transactions' && (
        <Card title="Your payment periods" description="ตัวอย่างส่วนประกอบสรุปรอบจ่าย">
          <div className={styles.statuses}>
            <StatusBadge status="part-paid" />
          </div>
          <Money value={s.overview.obligation.confirmedUnpaid} className={styles.figure} />
          <p className="muted">ยอดคงเหลือ ณ เวลาสรุป</p>
          <Button variant="primary" onClick={() => setSheet(true)}>
            ดูรายละเอียดรอบจ่าย <ArrowUpRight size={18} />
          </Button>
        </Card>
      )}
      <section className={styles.scenarioPanel} aria-label="ชุดตรวจส่วนประกอบ">
        <h2>Foundation components</h2>
        <p className="muted small">Development only · ตัวเลือกนี้ไม่เปิดใน production</p>
        <div className={styles.scenarioControls}>
          <label>
            สถานการณ์{' '}
            <select
              aria-label="สถานการณ์ข้อมูล"
              value={name}
              onChange={(e) => setName(e.target.value as ScenarioName)}
            >
              {scenarioNames.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <Button
            onClick={() => {
              revision.current = {
                ...revision.current,
                earningsRevision: (BigInt(revision.current.earningsRevision) + 1n).toString(),
              };
            }}
          >
            จำลอง revision ใหม่
          </Button>
          <span role="status" className="small muted">
            {changed}
          </span>
        </div>
        <div className={styles.stateGrid}>
          {(['loading', 'empty', 'error', 'partial', 'stale', 'unavailable'] as const).map(
            (state) => (
              <DataState
                key={state}
                state={state}
                onRetry={() => setDialog('ลองโหลดข้อมูลอีกครั้ง')}
              />
            ),
          )}
        </div>
        <div className={styles.statuses}>
          {(
            [
              'estimated',
              'confirmed',
              'adjustment',
              'pending',
              'part-paid',
              'paid',
              'credit',
            ] as Status[]
          ).map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
        <p className="small muted">
          จำนวนเงินขนาดใหญ่: <Money value={money('900719925474099301')} />
        </p>
        <Card title="ทดสอบข้อความภาษาไทยที่ยาวมากเพื่อให้มั่นใจว่าส่วนประกอบอ่านได้ครบทุกขนาดหน้าจอและไม่ล้นออกนอกกรอบ">
          <div className={styles.stress}>
            <CoverImage
              src="/media/intentionally-missing-cover.png"
              alt="ภาพตัวอย่างที่โหลดไม่สำเร็จ"
              className={styles.cover}
            />
            <Money value={money('900719925474099301')} />
          </div>
        </Card>
      </section>
      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog ?? ''}>
        <p>ตัวอย่างหน้าต่างรายละเอียดสำหรับตรวจรูปแบบ การอ่าน และการใช้คีย์บอร์ด</p>
        <p className="muted">ข้อมูลและการดาวน์โหลดจริงจะเชื่อมในขั้นถัดไป</p>
        <Button variant="primary" onClick={() => setDialog(null)}>
          เข้าใจแล้ว
        </Button>
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="รายละเอียดรอบจ่าย">
        <StatusBadge status="part-paid" />
        <p>ยอดยืนยันแล้ว</p>
        <Money value={s.statement.statement.newEarnings} className={styles.figure} />
        <p>
          จ่ายแล้ว <Money value={s.statement.statement.settled} />
        </p>
        <div className={styles.divider} />
        <p>
          ยอดคงเหลือ <Money value={s.statement.statement.closing} />
        </p>
        <p className="muted small">ข้อมูลจำลองเพื่อทดสอบส่วนประกอบ</p>
      </Sheet>
      <MusicToggle />
    </AppShell>
  );
}
