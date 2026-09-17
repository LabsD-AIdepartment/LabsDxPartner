# Payment review — ถอนตามคำขอของพาร์ทเนอร์

วันที่: 14 กันยายน 2569
สถานะ: รีวิวโค้ดและปรับแผนเท่านั้น ยังไม่แก้โค้ด/ฐานข้อมูลหรือเปิดการถอน
ข้อกำหนดจาก owner: ไม่จ่ายตามรอบ ให้ดารา/พาร์ทเนอร์กด withdraw เอง
เอกสารนี้แทนสมมุติฐาน scheduled payout ในแผน payment และปรับแผนเอกสาร PDF ที่เขียนก่อนหน้า

## 1. ข้อค้นพบจากระบบจริง

1. `src/features/overview/PayoutSummary.tsx`: การ์ด Your next payout แสดงวันกำหนดจ่าย/ยอดของงวดและลิงก์ดูรอบจ่าย ไม่ใช่ปุ่มถอน
2. `src/server/modules/statements/publish.ts`: Publish บังคับ scheduledAt และต้องไม่น้อยกว่า period_to; การเผยแพร่ผูกการยืนยันยอดกับกำหนดจ่าย
3. `db/migrations/0011_financial_approval_statements.sql`: scheduled_at NOT NULL + CHECK(scheduled_at >= period_to); เปลี่ยนข้อความ UI อย่างเดียวไม่พอ
4. `src/server/modules/earnings/overview.ts`: ยอดคงค้างรวมจาก published statements หัก allocations; next_payout เลือก statement ยอดบวกที่วันกำหนดจ่ายมาก่อน มีการซ่อน next เมื่อมี negative credit
5. `src/server/modules/statements/settle.ts`: รับผลการจ่ายที่เกิดแล้วจาก source และบันทึก cash/WHT/other พร้อม allocation ราย statement; ไม่ใช่ API สั่งโอนเงิน ไม่ใช่ withdrawal service
6. importer เดิมมี current capability checks, partner lock, idempotency และ source-reference dedup; ตรวจยอดไม่เกินราย statement และยอดคงค้างรวมรวมเครดิตติดลบแล้ว ใช้ integer minor units
7. `src/server/modules/statements/settlement-source.ts`: รับ allocation ไม่เกิน100 statements ต่อ payment; รองรับ full reversal เดียว ไม่รองรับ partial reversal โดยปริยาย
8. ไม่พบ withdrawal request/reservation/payout attempt/payout execution adapter ใน src/app/db ที่ตรวจ; ไม่มีเหตุให้กล่าวว่าปุ่ม withdraw จะโอนได้ทันทีอยู่แล้ว
9. ขอบเขตยอดเดิมเป็น partner; ยังต้องเพิ่ม payer-entity/currency ก่อนรองรับบริษัทผู้จ่ายหลายแห่ง ห้ามรวมภาระของต่างนิติบุคคลเป็นยอดเดียวแล้วหักภาษีครั้งเดียว
10. การเปลี่ยน flow นี้ยังไม่กระทบงานบัญชีผู้ใช้/รหัสผ่าน และไม่ใช่เหตุให้สร้าง wallet เติมเงิน โอนระหว่างผู้ใช้ หรือระบบบัญชีแยกประเภทเต็มชุด

## 2. รูปแบบที่เหมาะกับธุรกิจ

เป็นการถอนค่าตอบแทนที่พร้อมจ่ายจาก Labs D เท่านั้น ไม่ใช่บัญชีเงินฝากหรือยอดขายรวม
แยกสามเหตุการณ์: เกิดรายได้ -> ผ่านเงื่อนไขพร้อมจ่าย -> พาร์ทเนอร์ขอถอน/จ่ายจริง
ช่วงวันที่ในรายงานใช้วิเคราะห์ผลงาน ส่วนยอดถอนได้เป็นยอดปัจจุบันตามบริษัทผู้จ่าย ไม่ขึ้นกับ range/brand ของกราฟ
ยังมีใบสรุปรายเดือนเพื่อบัญชีและภาษีได้ แต่การสร้าง/ปิดใบสรุปไม่ใช่เงื่อนไขให้กดถอน
การซิงก์/ยืนยันรายได้ทำต่อเนื่องตามข้อมูลต้นทางได้ ไม่ต้องให้คนอนุมัติทุกรายการ; รายการที่ผิดเงื่อนไขเท่านั้นเข้าคิวแก้

### Flow ที่ดาราเห็น

ดูยอดถอนได้ -> กดถอน -> เลือกทั้งหมดหรือระบุยอด -> เห็นยอดก่อนหัก ภาษี/ค่าธรรมเนียมถ้ามี เงินสุทธิ และบัญชีปลายทาง -> ยืนยัน -> ติดตามสถานะ -> ดาวน์โหลดเอกสาร

- เสนอค่าเริ่มต้น “ถอนทั้งหมด” และรองรับยอดบางส่วนภายในยอดที่พร้อมจ่าย
- แสดงบัญชีปลายทางปกปิดบางส่วนและชื่อผู้รับให้ตรวจ ไม่มีการกรอกเลขบัญชีใหม่ทุกครั้ง
- เมื่อยอด/นโยบายภาษีเปลี่ยนก่อนยืนยัน ให้เสนอราคาใหม่ ไม่เปลี่ยนยอดสุทธิเงียบ ๆ
- กรณีไม่มีข้อมูลภาษี/บัญชีรับเงิน ให้บอกข้อมูลที่ขาดและลิงก์แก้ไข ไม่แสดง 0 แทน unknown
- “ถอนได้ทุกเมื่อ” หมายถึงส่งคำขอได้ตามยอดและเงื่อนไข ไม่สัญญาเงินเข้าทันทีถ้าช่องทางโอนไม่รองรับ
- ไม่กำหนดขั้นต่ำ ค่าถอน ระยะhold หรือ SLA ขึ้นเอง ต้องตั้งจากข้อตกลง/ต้นทุนจริง
- ทางเลือกเริ่มง่าย: หนึ่งคำขอที่กำลังดำเนินการต่อผู้รับ/ผู้จ่าย เพื่อติดตามง่าย (ข้อเสนอ ยังไม่ได้ยืนยัน); backend ต้องกันกดซ้ำ/แข่งกันแม้มีข้อจำกัด UI

## 3. ยอดคงเหลือและความหมาย

แสดง 3 ก้อนหลัก: ยังไม่พร้อมถอน / พร้อมถอน / กำลังถอน และดูยอดจ่ายสำเร็จในประวัติ
ต้องมีชั้น readiness ที่แยก estimated -> confirmed-pending-eligibility -> released ไม่ถือว่า platform reported conversions เป็นรายได้พร้อมถอน
ตัวอย่างเงื่อนไข release: ยอดต้นทางยืนยันตามสัญญา ผ่านเงื่อนไขคืนสินค้า/ข้อพิพาทที่เกี่ยวข้อง และระบุผู้รับ/ข้อตกลงถูกต้อง ไม่มี hold ระยะตายตัวที่ผู้พัฒนาคิดเอง

ต่อ partner + payer entity + currency:
- netReleased = ผลรวม signed released credits/debits หลังปรับปรุง (นับแต่ละ entitlement ครั้งเดียว)
- netSettled = ผลรวมภาระที่ชำระจริง หักการกลับรายการที่ยืนยันแล้ว
- activeReserved = ภาระที่กันไว้ในคำขอ active รวมสถานะโอนที่ยังไม่ทราบผล
- riskHeld = ยอด hold ที่แยกจาก activeReserved ไม่หักซ้ำ และมีเหตุผล/ผู้รับผิดชอบ
- rawAvailable = netReleased - netSettled - activeReserved - riskHeld
- availableToRequest = max(0, rawAvailable); ถ้า rawAvailable ติดลบเก็บ debt/deficit จริงไว้ ไม่ล้างทิ้งเมื่อแสดง0
- ภาระที่ชำระ = เงินโอน + ภาษีหัก ณ ที่จ่าย + องค์ประกอบอื่นที่อนุญาตและตรวจแล้ว; กดถอนหนึ่งครั้งต้องแยก gross obligation จาก net cash ชัด

ตัวอย่างเพื่ออธิบายเท่านั้น: พร้อมถอนก่อนหัก10,000 ขอถอน4,000 -> พร้อมถอนเหลือ6,000 + กำลังถอน4,000; ถ้ารายการสำเร็จ ยอดกัน4,000ถูกเปลี่ยนเป็นชำระจริง4,000ใน transaction เดียว ยอดพร้อมถอนยัง6,000 ไม่ลดซ้ำอีกครั้ง
การคำนวณ VAT/WHT ไม่ใส่อัตราเดา; ต้องกำหนดด้วยว่า released obligation รวม VAT หรือไม่ก่อนย้ายข้อมูล

## 4. สิ่งที่ใช้ของเดิมและสิ่งที่เพิ่ม

### ใช้ต่อ
- แหล่งรายได้ ข้อตกลง version การแก้ไขยอดและหลักฐานเดิม
- integer minor units / BigInt, reconciliation, source-reference uniqueness และ audit/idempotency pattern
- native session/membership checks และการจัดขอบเขตพาร์ทเนอร์
- statement เดิม/CSV เป็นประวัติและรายงานบัญชี ไม่เปลี่ยนให้เป็น withdrawal ย้อนหลัง
- settlement history เป็นหลักฐานจ่ายจริง ห้ามสร้างประวัติ paid ให้คำขอที่เพิ่งกด

### เพิ่มเป็นโมดูลขนาดจำเป็น
- `balances`: released entitlement postings/readiness/holds และ available read model; เป็นเจ้าของสูตรถอนได้ อ่านจาก earning source เดิม ไม่ตั้งยอดหน้าเว็บเอง
- `withdrawals`: quote/request/reservation/allocation/state transitions/cancellation; เป็นเจ้าของยอดกันคำขอ
- `payouts`: payout instructions/attempts + adapter ให้ฝ่ายการเงินหรือผู้ให้บริการโอน + reconciliation; แยกคำสั่งออกจากผลโอน
- `documents`: เอกสารตามคำขอ/ผลจ่ายและ tax snapshot; ใช้แบบกลางจากแผน PDF
- `beneficiaries`: บัญชีผู้รับที่ตรวจแล้วและ version; คำขอ pin ปลายทางไว้ไม่เปลี่ยนตาม profile ที่แก้ทีหลัง

ทั้งหมดอยู่โปรเจ็กต์/ฐานข้อมูลเดิมได้ ยังไม่ต้องแยก microservices; worker queue มีเพียงส่งคำสั่ง/ติดตามผลที่จำเป็น
dependency: earning facts -> released balance -> withdrawal reservation -> payout instruction -> verified settlement + reservation consumption -> documents/read models
ภาษีหักจริงอ้างอิงเหตุการณ์จ่ายที่บัญชียืนยัน ไม่อาศัยสถานะ requested อย่างเดียว

## 5. ความถูกต้องที่ต้องเพิ่มก่อนเปิด withdraw

### การกันยอดและไม่โอนซ้ำ
- quote เป็นข้อมูลแสดงเท่านั้น ไม่กันเงิน; POST request ต้อง recheck current permission, balance, policy, beneficiary version และ quote expiry ใน server transaction
- debit/reserve ภายใต้ lock ตามขอบเขตการเงินเดียวกับการปรับยอด/settlement; unique idempotency key ผูก actor+payload กดซ้ำได้ผลเดิม ถ้าเปลี่ยนpayloadด้วยkeyเดิมต้องreject
- บันทึกคำขอ reservation และ outbox พร้อมกัน; ห้ามเรียกธนาคารขณะเปิด DB transaction
- ใช้ payout instruction ID เดิมเป็น idempotency key ที่ provider รองรับ; retry ไม่สร้างคำสั่งธุรกิจใหม่
- webhook/status proof ต้องตรวจแหล่งที่มา จำนวนเงิน สกุล ผู้รับ และ reference ก่อนเปลี่ยน paid; จัดการซ้ำและมาผิดลำดับ
- provider timeout = unknown/กำลังตรวจสอบ ไม่เท่ากับโอนไม่สำเร็จ; คงกันยอดและ query/reconcile ก่อน retry/release
- ถ้ายกเลิกได้เฉพาะก่อนส่งคำสั่งจริง ให้ใช้ atomic state check; หลังส่งแล้วต้องมีหลักฐานว่ายกเลิกได้ ไม่ใช้ปุ่มคืนยอดทันที

### ต้องแก้ importer เดิมด้วย ไม่ทำ reservation ข้างเดียว
- `settle.ts` ปัจจุบันไม่เห็น active reservations: การจ่ายจาก ERP นอกคำขออาจใช้ยอดที่กันไว้ หากเพิ่มเฉพาะ service withdraw
- matched settlement ใช้ withdrawal/payout reference ที่ชัดและตรวจ payload: ลงผลจ่ายพร้อม consume reservation ใน transaction เดียว
- external/unmatched settlement เป็นเหตุการณ์เงินจริง ต้องรับเข้า reconciliation ให้ถูกข้อเท็จจริง ไม่ทิ้งข้อมูลเพียงเพราะเกิน available ที่คำนวณ
- เมื่อจ่ายนอกคำขอชน reservation ให้ mark deficit/hold dispatch ที่ยังไม่ส่ง แจ้งบัญชีแก้เฉพาะรายการนั้น; ห้ามจับคู่ตามจำนวนเงินเท่ากันอย่างเดียว
- negative correction หลังขอถอน: ก่อน dispatch recheck และ hold/requote/ยกเลิกตามสิทธิ; ถ้าจ่ายแล้วเก็บ negative balance/หักรายได้อนาคตตามสัญญา ไม่ลบประวัติ
- reversal จาก source ไม่เท่ากับเงินคืนบัญชีบริษัทเสมอ ต้องจำแนกข้อเท็จจริง/หลักฐานก่อนเปิดยอดถอนได้คืน
- partial payout/return ต้อง allocate ตามผลที่ตรวจแล้ว ห้าม markทั้งคำขอpaidหรือreleaseทั้งก้อน; ถ้าadapterรองรับเฉพาะเต็มจำนวน ให้ส่วนที่ไม่ตรงเข้าคิวreconcile

## 6. สถานะที่เสนอ

ภายใน: requested -> queued -> submitting -> processing -> paid
ทางเลือก: rejected/cancelled ก่อนส่ง; failed เมื่อยืนยันว่าไม่เกิดการโอน; unknown เมื่อยังไม่รู้ผล; reconcile-required เมื่อยอด/ผลไม่ตรง
worker crash หลังส่งแต่ก่อนบันทึก provider ID ต้องตามกลับด้วย instruction ID; ไม่ปล่อย reservation ตาม timeout อย่างเดียว
คำขอที่เสร็จแล้วไม่ย้อนstateเพราะwebhookเก่า; เงินถูกตีกลับหลังpaidเป็นเหตุการณ์ใหม่ linked return/reversal

หน้า user ลดเหลือ: รับคำขอแล้ว / กำลังโอน / สำเร็จ / ไม่สำเร็จ / กำลังตรวจสอบ พร้อมข้อความที่ใช้ตัดสินใจได้
ไม่จำเป็นต้องสร้างชั้น “อนุมัติรายได้” และ “อนุมัติถอน” ซ้ำกันทุกครั้ง; เคสปกติใช้กติกาที่ตั้งไว้ เคสผิดเงื่อนไขให้คนดู

## 7. ข้อเปลี่ยนหน้าเว็บ

- เปลี่ยนเนื้อหา PayoutSummary ในการ์ดตำแหน่งเดิมเป็น “ยอดที่ถอนได้” + ยอดก่อนหัก + “ถอนเงิน” + กำลังถอน; คงดีไซน์และขนาดตัวอักษรเดิม
- ถอนผ่าน dialog/page shared component: ยอด/ปลายทาง/รายละเอียดหัก/สุทธิ/ระยะดำเนินการที่ตั้งจริง/ยืนยัน
- Transactions แสดงประวัติถอนเป็นหลัก มีลิงก์รายละเอียด/เอกสาร; ใบสรุปรายได้ยังเปิดดูได้อีกกลุ่ม ไม่ลบข้อมูลเก่า
- หลังบ้าน payment เป็นคิวคำขอถอนและรายการผิดปกติ/สถานะโอน แทนหน้าตั้งวันจ่ายรายงวด
- ไม่ให้ตัวกรองกราฟทำให้ available balance เปลี่ยนตาม; แสดง current as-of/revision ภายใน data model และรีเฟรชอัตโนมัติหลังคำขอ/ผลจ่าย
- คำขอถอนเป็น permission ใหม่ แยก view_statements กับ request_withdrawal; ไม่ให้ผู้ช่วยดาราที่ดูข้อมูลได้ถอนโดยอัตโนมัติ
- ไม่บังคับตั้งบัญชี/passwordใหม่เพื่อใช้feature; บัญชีธนาคารใหม่หรือเปลี่ยนปลายทางเป็นเหตุการณ์ตรวจสิทธิ์ตามความเสี่ยง ไม่ขอเอกสารซ้ำทุกครั้ง

## 8. ผลต่อเอกสารการเงิน/PDF

1. รายงาน/ใบสรุปเป็นรายช่วงเวลาได้ แต่ไม่ต้องสร้าง invoice ใหม่ทุกการกดดูรายงาน
2. ผูก withdrawal หนึ่งรายการกับรายการภาระที่ใช้ทั้งหมด (อาจหลายช่วง) และ invoice references; ไม่สร้าง invoice ซ้ำของรายได้เดียวเพราะถอนบางส่วนหลายครั้ง
3. ใบยืนยันคำขอถอนออกได้เมื่อรับคำขอ แต่เป็นหลักฐานคำขอ ไม่ใช่ใบเสร็จหรือหลักฐานว่าโอนแล้ว
4. payment advice/หลักฐานโอนเกิดจากผลการจ่ายที่ยืนยันแล้ว; invoice/ใบกำกับ/receipt ใช้ผู้ออกและจังหวะที่ถูกต้องตามบัญชี ไม่เหมารวมทุกชนิดเป็นpaid trigger
5. 50 ทวิผูกเหตุการณ์เงินได้/ภาษีที่หักจริงและจัดสรรต่อการจ่าย ไม่ออกจากยอดที่เพิ่งขอถอน; ตรวจกรณีแบ่งจ่ายตามนโยบาย/แบบที่ใช้
6. เอกสารตรึงชื่อ/ที่อยู่/เลขภาษี/ผู้จ่าย/ผู้รับ/tax version ในฉบับนั้น; เปลี่ยนข้อมูลภายหลังไม่เปลี่ยน PDF ที่ออกแล้ว
7. การทำ PDF รายงานกลางเริ่มได้ต่อ แต่การออกเอกสารการเงินจริงต้องวาง quote/allocation/payment events ใหม่นี้ก่อน ไม่ต่อยอดจาก scheduled payout

## 9. แผนเปลี่ยนระบบทีละ task

W01 — ขอบเขตยอดและสัญญาข้อมูล
- ยืนยัน release rule, payer/currency, gross/net/VAT/WHT, withdrawal execution model, beneficiary ownership และกรณีเดิมเป็นnegative credit
- ออกแบบ typed balance/quote/request/state contracts และ fixtureตัวอย่าง ไม่มีโอนเงินจริง
- จบเมื่อยอดคงเหลือทุกรูปแบบอธิบายได้ และแยก current finance facts vs proposed policy ชัด

W02 — จองยอดและคำขอถอน (local mock)
- migration additive สำหรับ readiness/reservations/requests/events/outbox/beneficiary versions ตามที่จำเป็น
- integration tests concurrent withdraw, duplicate submit, corrections, unmatched settlements, cancellation/dispatch race, unknown provider result
- ปรับ settlement importer ให้รู้ reservation/reconciliation พร้อมกัน ไม่ปล่อยหน้า withdraw ก่อน invariantครบ

W03 — หน้า user และคิวหลังบ้าน
- เปลี่ยนการ์ดเดิม เพิ่มถอน/ประวัติ/คิว ใช้ API mock/localจริง ตรวจ responsive/sharedcomponents และpermission
- จบเมื่อ owner สมมุติเป็นดารากดถอนบางส่วนแล้วเห็น available/reserved/historyตรงกัน; ไม่มีบัญชีใหม่หรือทดสอบpasswordรอบใหญ่

W04 — เชื่อมวิธีจ่ายที่เลือก
- finance-operated adapter หรือ payout provider ตามคำตอบ owner; providerหลักยังไม่เลือก ไม่เดาAPIหรือสิทธิธนาคาร
- ถ้าเริ่มทีมการเงิน: claimคำขอ/ยืนยันผู้รับ/reference ผลจ่ายที่ตรวจได้ และ reconciliation; เป็นงานชั่วคราวที่เห็นได้ ไม่เรียกว่าระบบโอนอัตโนมัติ
- ถ้าauto: ส่งinstruction+provideridempotency+status/webhook+reconcile+resource limits; ทำcontract/sandboxก่อนเปิดใช้จริง
- ไม่มีการโอนเงินจริงในงานรีวิวนี้; การเปิดเงินจริงต้องมีช่องทางพร้อมและ owner อนุญาตการใช้งานเป้าหมาย

W05 — เอกสารตามการถอนและเปิดใช้
- ต่อ document plan ร่าง/registry/PDF/tax/issuance ตามเหตุการณ์ใหม่ ตรวจแบ่งจ่ายและเอกสารไม่ซ้ำ
- ปิดscheduled issuanceใหม่ ปรับmigration/consumerที่บังคับscheduledAtโดยไม่แก้migrationเก่าที่ใช้แล้ว
- เปิดจากแบบทดสอบและcaseบัญชีก่อนจริง; เงินโอน/สำรอง/กู้คืน/ติดตามผลต้องตรวจครบในtargetที่เลือก

ทำทีละ task ตามที่ owner เลือก ไม่มีคำสั่งให้เริ่ม W01-W05 จากการรีวิวนี้

## 10. Compatibility, migration และ rollback

- เติม readiness/released postings โดยอ้างอิง entitlement stable key + source revision; cumulative snapshot syncต้องลงdelta/version ไม่เพิ่มยอดซ้ำทุกครั้ง
- backfill opening released balance จากยอดเดิมที่reconcileแล้วรวมnegativecredits/allocations ไม่เติมทั้งstatementและearningrowsซ้ำ
- กรณีเดิมมีใบสรุปรายเดือนแต่ต้องreleaseรายรายการ ต้องแยกฐานพร้อมถอนออกจากการปิดงวดจริง ไม่แค่ตัดscheduledAtแล้วรอmonthly publishเหมือนเดิม
- เก็บ statement/settlementเก่าตามจริง; ข้อมูลที่ยังระบุ payer/taxไม่ครบเป็นneeds-mapping ไม่ผูกบริษัทสมมุติให้ภาระเงินจริง
- source settlement allocationsเดิมสูงสุด100statementต้องทบทวนเมื่อถอนข้ามหลายช่วง; ใช้posting allocationใหม่หรือกำหนดขอบเขตที่เปิดเผย ไม่ตัดรายการทิ้ง
- transition read API additive; old scheduledAt fieldsคงอ่านย้อนหลังได้ แต่withdraw UIใหม่ไม่ใช้เป็นกำหนดจ่าย
- shutdown/rollback ปิดรับคำขอใหม่แต่คงreconcileและกันยอดคำขอที่ส่งไปแล้วไว้; ห้าม rollbackทำให้ยอดโอนแล้วกลับเป็นavailable
- ไม่เปิดlegacy scheduled dispatchควบคู่แบบไม่ตรวจreservation; ปัจจุบันไม่พบdispatchเดิม แต่ต้องยืนยันการจ่ายนอกระบบจากบัญชีระหว่างcutover

## 11. ขอบเขตและข้อที่ยังไม่ยืนยัน

Change Mode: B1/B2 เปลี่ยนจุดเริ่มการจ่าย; B3/B4 เพิ่มโมดูลการถอนและแทนการ์ดเดิม; B8 เพิ่มเจ้าของreservation/available/instruction พร้อมauthoritative outcome; B9 แยกสิทธิ์ถอนและฝั่งprovider; B10 ระบุผู้ดำเนินการ/ดูexception
B5/B6/B7 คงระบบเดิมเป็นค่าเริ่มต้น เพิ่มworkerเฉพาะส่ง/ติดตามคำสั่งเมื่อเลือกช่องทาง ไม่อ้างว่าbankอยู่ในDBtransaction

Ownerยืนยันแล้ว: เปลี่ยนเป็นถอนตามคำขอ; Portalเป็นระบบเอกสารหลัก
ยังรอ: auto-transfer vs finance-operated vsเริ่มfinanceแล้วauto, readinessตามสัญญา, limits/fees/SLAถ้ามี, ผู้ออกเอกสาร/ข้อมูลภาษีจากแผนก่อน
สมมุติฐานออกแบบเพื่อ review: มีทั้งpartial/all, แสดงgrossก่อนหักและnetก่อนconfirm, adapterรองรับสองexecutionmodel; ไม่ใช่นโยบายที่ownerยืนยันแล้ว

อนุญาตรอบนี้: read-only code review และแก้เอกสารแผน/context
ยังไม่ดำเนินการ: source code, migration, runtime, การย้ายเงินจริง, เปิดproviderหรือเอกสารทางการ
Boundary verdict for declared review and revised plan: READY FOR DECLARED SCOPE

## 12. Execution backlog — 14 กันยายน 2569 (owner ขอส่ง Opus 4.8 ลงมือ)

อัปเดตอำนาจ: owner ขอแผนก่อนลงมือและส่งให้ Opus4.8 implement; จึงส่งงานแรกที่ไม่ขึ้นกับคำตอบธุรกิจเป็น W01-A เท่านั้นเมื่อแผนนี้เขียนครบ แล้ว root ตรวจรับก่อนขยาย task อื่น
Opus4.8 เป็นผู้เขียน implementation, Codex root เป็นผู้ตรวจรับต่างโมเดล; ห้ามแทนโมเดลที่ownerระบุโดยเงียบ ๆ

| เฟส / Task | ทำอะไร / จุดที่เปลี่ยน | Dependency | สิ่งส่งมอบและเงื่อนไขจบ |
|---|---|---|---|
| 1 / W01-A | typed contracts ของ balance/quote/request/status + pure exact-balance calculation | reviewนี้ | ใช้ common.Money/Minor/Id เดิม; unknownไม่เท่ากับ0; signed deficitไม่หาย; unitตัวเลขใหญ่/สตางค์/กันยอด; ยังไม่มี endpoint/DB/UI |
| 1 / W01-B | ข้อกำหนด readiness/tax/payer/beneficiary + fixture golden case | W01-A | schema/version input ที่ระบุ approved/unknown; fixtureแยกชัดไม่เป็นdefaultธุรกิจ; mapping factsเดิมและข้อมูลขาด; ปิดนโยบายที่ยังunknownไม่ได้ |
| 2 / W02-A | additive schema: earning release postings, requests, reservations, audit/revisions | W01-A/B; migration design | unique source keys/scope/amount constraints; migrationใหม่ collisionfree; clean testDB+upgradepath ไม่แก้appliedmigration |
| 2 / W02-B | server balance reader + quote API | W02-A | รู้สิทธิ์และpartner/payer/currency; ดูยอดปัจจุบันไม่ผูกกราฟ; quoteexpiring+versioned ไม่reserve; missing tax configส่งissueชัด |
| 2 / W02-C | request/cancel/reserve transaction + outbox admission | W02-B | samekey replayเดิม; differentpayloadreject; สองrequestแข่งไม่ใช้ยอดเดียวกัน; cancelraceมีผลครั้งเดียว; ไม่มีbankcallในtransaction |
| 2 / W02-D | ปรับ settlement/correction path ให้เข้ากับreservation | W02-C | matchedผลจ่าย consumehold+settleatomic; unmatched/negative/returnedเงินเข้าคิวreconcile; nooverspendจากlegacywriter; partial outcomeไม่markทั้งก้อนpaid |
| 3 / W03-A | shared WithdrawCard/WithdrawForm/WithdrawalStatus/AmountBreakdown | W02-B/C/D; sampleUIก่อนต่อAPIได้ | อยู่การ์ดเดิม; ถอนทั้งหมด/บางส่วน; gross/tax/net; keyboard/mobile/daydark; min16px; ไม่เปลี่ยนportrait/layoutหลัก |
| 3 / W03-B | ประวัติถอน + detail + polling/invalidation | W03-A | refresh/reloadแล้วยังเห็นrequestเดิม; staleคำตอบไม่ทับscopeใหม่; ไม่pollทั้งระบบ; ทุกสถานะอ่านรู้เรื่อง; statementเก่ายังเปิดได้ |
| 3 / W03-C | staff queue/claim/exception screen | W02-D,W03-A | capabilityแยกจากmarketing/view-only; filterสถานะและdetailที่จำเป็น; no duplicate approval layer ถ้าไม่มีเหตุ |
| 4 / W04-A | payout adapter contract + simulator + worker/state recovery | W02-D | จำลอง success/failure/unknown/double-event/crash; boundedworker; instructionkeyเดิม; unknownคงreserve; testsไม่เรียกบริการเงินจริง |
| 4 / W04-B | bindช่องทางเงินจริงที่ownerเลือก | W04-A + decision & providerพร้อม | finance-operated หรือ API providerตามคำตอบ; recipientverification/receipt/status mapping; sandbox evidence; ยังไม่เปิดโอนจริงจนอนุญาต |
| 5 / W05-A | PDFใบยืนยันคำขอ/ประวัติ/ใบสรุป | W03-B/W04-A + document renderer | Thai embeddedfont/searchable/multipage; snapshotตรงrequest/statement; ใบยืนยันคำขอไม่แสดงpaid; เก็บCSVไว้ |
| 5 / W05-B | invoice/receipt/WHT + registry/tax snapshot | W05-A + issuer/tax factsพร้อม | sourceallocationไม่ออกinvoiceซ้ำเมื่อแบ่งถอน; เอกสารแต่ละชนิดมีtriggerถูกต้อง; official numbering/archive/reissueตามdocumentplan; ไม่ออกแทนดาราโดยไม่มีอำนาจ |
| 6 / W06-A | backfill/cutover/reconciliation | W02-D,W04-B | dry-runยอดก่อนหลังเท่ากันทุกscope; no doublecountopening+rows; signedcreditsครบ; ปิดคำสั่งจ่ายเดิมที่ชนreservation; appliedmigrationไม่แก้ |
| 6 / W06-B | release acceptance / recovery / เปิดกลุ่มแรก | W06-A,W05Bตามเอกสารที่ต้องใช้ | exactcandidate review; loadที่ระบุจริง; backup+restoreproof; monitorและเจ้าของexception; rollbackคงin-flight; ownerอนุญาตเงินจริงก่อนenable |

### ความคืบหน้าที่รายงานได้โดยไม่สับสน
- NOT_STARTED -> IN_PROGRESS -> READY_FOR_REVIEW -> ACCEPTED; BLOCKEDต้องระบุ input ที่ขาดและงานอื่นที่ไม่ติด
- ผู้เขียนส่ง task ID, ไฟล์เปลี่ยน, acceptance evidence, ข้อจำกัด และงานถัดไปที่เสนอ
- rootตรวจ exact files/tests ไม่ยึดคำว่าPASSจากผู้เขียนอย่างเดียว; ถ้าแก้เพิ่มต้องทวนเงื่อนไขที่กระทบอีกครั้ง
- W01-A จบเมื่อ rootรับแล้ว ให้หยุดส่งรายงาน ไม่วนทำทั้งตารางอัตโนมัติ
- featureที่ยังใช้ simulatorต้องติดlabelทดสอบ; ห้ามแสดงว่าพร้อมโอนเงินจริงหรือเอกสารใช้ทางภาษีได้แล้ว

### Contract outline (design targets, W01-A ต้องตรวจชื่อชนกับของเดิม)

BalanceSnapshot: scope(partnerId,payerId,currency), revision, asOf, state(known/unavailable), released, settled, reserved, held, rawAvailable, available, deficit; missinginputsส่งreason ไม่ให้สรุปยอดเทียม
WithdrawalQuote: scope, quoteId, expiresAt, balanceRevision, policyVersion, beneficiaryVersion, requestedObligation, withholding, fees(ifconfigured), otherSettled, netCash, allocationReferences; quoteไม่เชื่อถือเป็นauthorityจนserverตรวจใหม่
CreateWithdrawal: quoteId, idempotencyKey; scopeมาจากsessionและserver binding ไม่เชื่อpartnerIdหรือamountจากbrowserเพียงอย่างเดียว
WithdrawalRecord: ID, scope, status, amountsSnapshot, beneficiarySnapshotRef, requestedAt, updatedAt, instructionRef?, outcomeRef?; ภาษี/บัญชีละเอียดอ่านได้เฉพาะสิทธิ์
PayoutAdapter: submit(instructionId, verifiedInstruction), getStatus(instructionId), verifiedOutcome; ไม่บังคับcancel APIถ้าproviderไม่รองรับ; ห้ามจำลองexactly-onceจากtimeout

W01-A ไม่ต้องเขียนทั้งหมดละเอียดเกินงาน ให้contractขั้นต่ำและ purebalanceก่อน ส่วนquote tax/allocationsที่ยังไม่รู้ต้องunknown/validationissue ห้ามเติมpolicyเดา

### Acceptance example pack

- released1000000 minor, settled200000, reserved300000, held100000 -> available400000, deficit0
- correctionทำ released100000, settled200000 -> rawAvailable-100000, available0, deficit100000 (ไม่ลบหนี้)
- released1000000, reserve400000 -> available600000; settlement400000+consumehold400000 -> availableยัง600000
- หน่วยเงินใหญ่กว่า Number.MAX_SAFE_INTEGERยังคงexact; currencyไม่ตรงห้ามรวม; reservation/holdไม่ติดลบ; ยอดsettledอาจsignedเมื่อรวมreversalตามนิยามที่ยืนยัน
- unknownsource/profile -> unavailable ไม่แปลงเป็น0แล้วให้ถอน
- กด2ครั้งจากสองtab เงินพอครั้งเดียว -> รับได้ครั้งเดียว; duplicatekeypayloadเดิม -> IDเดิม
- providerรับคำสั่งแล้วconnectiontimeout -> unknown+reserved; สั่งretryไม่โอนซ้ำ; poll/webhookconfirmครั้งเดียว
- ยืนยันจ่ายบางส่วน -> settleเฉพาะส่วนที่ยืนยัน คงresidualreservationจนรู้ผลส่วนที่เหลือ

### Load และประสิทธิภาพ (เป้าหมายทดสอบเสนอ ไม่ใช่ผลวัดแล้ว)

- ก่อนโอนจริงเก็บ baseline บน data size ที่ownerจะใช้; reportp50/p95 พร้อมจำนวนrowsและconcurrencyจริง
- balanceอ่าน indexed projection/revision ไม่sumทั้งประวัติทุกpoll; reconcileกับauthoritativepostingsได้
- serialize mutationเฉพาะ financial scope ไม่ขยายglobal lockเป็นทุกwithdrawalของทุกคน; ให้W02ตรวจcompatibilityกับaccess-lockเดิมก่อนเลือกlockorder
- limit pagination/history, quote rate, workerconcurrencyและretrybackoffตามcapacity; ไม่ตั้ง SLA โอนเงินด้วยค่าความเร็วquery
