'use client';
import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { exportPitchTransfer, importPitchTransfer } from './pitch-transfer';
export function PitchTransferPanel({userId,partnerId}:{userId:string;partnerId:string}) {
  const [value,setValue]=useState('');const [message,setMessage]=useState('');
  function exportData(){try{setValue(JSON.stringify(exportPitchTransfer(window.sessionStorage,userId,partnerId)));setMessage('ส่งออกข้อมูลตัวอย่างแล้ว');}catch{setMessage('ส่งออกข้อมูลไม่สำเร็จ');}}
  function importData(){try{importPitchTransfer(window.sessionStorage,JSON.parse(value),userId,partnerId,true);window.location.assign('/overview?from=2026-07-01&toExclusive=2026-09-01&origin=overview');}catch{setMessage('นำเข้าไม่ได้: ตรวจสอบข้อมูลและบัญชีผู้ใช้');}}
  return <main style={{padding:24,maxWidth:900,margin:'auto'}}><Card title="ย้ายข้อมูล Wallet สำหรับนำเสนอ"><p>ย้ายเฉพาะรายการถอนจำลองและบัญชีรับเงินตัวอย่างของบัญชีนี้ ไม่มีรหัสผ่านหรือข้อมูลเข้าสู่ระบบ</p><div style={{display:'flex',gap:12,marginBlock:16}}><Button onClick={exportData}>ส่งออกข้อมูลตัวอย่าง</Button><Button onClick={importData} disabled={!value}>นำเข้าข้อมูลตัวอย่าง</Button></div><label htmlFor="pitch-transfer">ข้อมูลสำหรับย้าย</label><textarea id="pitch-transfer" value={value} onChange={e=>setValue(e.target.value)} style={{width:'100%',minHeight:260}} /><p role="status">{message}</p></Card></main>;
}
