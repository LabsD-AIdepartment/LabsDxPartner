'use client';
import type { z } from 'zod';
import type { PartnerCapability } from '@/contracts/access';
import forms from '@/shared/ui/forms.module.css';
export type Capability = z.infer<typeof PartnerCapability>;
export const capabilityLabels: Record<Capability, string> = {
  view_earnings: 'รายได้และคอมมิชชัน',
  view_content: 'คลิปและผลงาน',
  view_statements: 'รอบจ่ายและเอกสาร',
  view_ad_spend: 'ค่าใช้จ่ายโฆษณา',
};
export function CapabilityPicker({
  value,
  onChange,
  legend = 'ข้อมูลที่ดูได้',
}: {
  value: Capability[];
  onChange: (value: Capability[]) => void;
  legend?: string;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {Object.entries(capabilityLabels).map(([key, label]) => (
        <label key={key} className={forms.row}>
          <input
            type="checkbox"
            checked={value.includes(key as Capability)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...value, key as Capability] : value.filter((x) => x !== key),
              )
            }
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
