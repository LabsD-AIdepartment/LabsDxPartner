import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Text } from '@/shared/ui/Text';
import { TextGroup } from '@/shared/ui/TextGroup';
import { Card } from '@/shared/ui/Card';
import { Field } from '@/shared/ui/Field';
import textStyles from '@/shared/ui/text.module.css';

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? cssFiles(path) : path.endsWith('.css') ? [path] : [];
  });
}
describe('portal typography contract', () => {
  it('keeps heading and label semantics independent from the visual preset', () => {
    render(
      <>
        <Text as="h2" variant="caption">
          รายละเอียดคลิป
        </Text>
        <Text as="label" htmlFor="query" variant="label">
          ค้นหา
        </Text>
        <input id="query" />
      </>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'รายละเอียดคลิป' })).toBeVisible();
    expect(screen.getByLabelText('ค้นหา')).toBeVisible();
  });
  it('centralizes font definitions and preserves the agreed readable minimum', () => {
    const source = readFileSync(resolve('src/shared/theme/typography.css'), 'utf8');
    expect(source).toMatch(/--text-caption-size:\s*16px/);
    expect(source).toMatch(/--text-body-size:\s*16px/);
    for (const file of [...cssFiles('src'), ...cssFiles('dev'), ...cssFiles('app')]) {
      if (file.endsWith('/typography.css')) continue;
      const css = readFileSync(file, 'utf8');
      expect(css, file).not.toMatch(/font-size:\s*(?:\d|clamp|calc|min|max)/);
      expect(css, file).not.toMatch(/font-family:\s*['"]/);
    }
  });
  it('changes text leading independently of heading semantics and visual role', () => {
    const { rerender } = render(
      <Text as="h2" variant="caption" leading="reading" id="report-title">
        รายละเอียดรายงาน
      </Text>,
    );
    const title = screen.getByRole('heading', { level: 2, name: 'รายละเอียดรายงาน' });
    expect(title).toHaveClass(textStyles.caption, textStyles.leading_reading);
    expect(title).not.toHaveAttribute('leading');
    rerender(
      <Text as="h2" variant="caption" leading="compact" id="report-title">
        รายละเอียดรายงาน
      </Text>,
    );
    expect(title).toHaveClass(textStyles.caption, textStyles.leading_compact);
    expect(title).not.toHaveClass(textStyles.leading_reading);
    expect(title).toHaveAttribute('id', 'report-title');
  });
  it('groups phrasing content without losing labels, help or error associations', () => {
    render(
      <>
        <TextGroup as="span" layout="inline" spacing="tight" aria-label="คำทักทาย">
          <Text as="span">สวัสดี คุณพาร์ทเนอร์</Text>
          <span aria-hidden="true">✦</span>
          <Text as="small">นี่คือผลงานของคุณ</Text>
        </TextGroup>
        <Field label="ชื่อผู้ใช้" hint="ใช้ชื่อที่ลงทะเบียนไว้" error="กรุณาตรวจชื่อผู้ใช้" />
      </>,
    );
    const greeting = screen.getByLabelText('คำทักทาย');
    expect(greeting.tagName).toBe('SPAN');
    expect(greeting).toHaveClass(textStyles.inline, textStyles.gap_tight);
    expect(greeting).not.toHaveAttribute('layout');
    expect(greeting.querySelector('p, div')).toBeNull();
    const field = screen.getByRole('textbox');
    expect(field).toHaveAccessibleName(expect.stringContaining('ชื่อผู้ใช้'));
    expect(field).toHaveAccessibleDescription('ใช้ชื่อที่ลงทะเบียนไว้ กรุณาตรวจชื่อผู้ใช้');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('กรุณาตรวจชื่อผู้ใช้');
  });
  it('keeps card heading text grouped while actions and content retain separate structure', () => {
    render(
      <Card title="คอมมิชชัน" description="ยอดที่ยืนยันแล้ว" action={<button>ดูทั้งหมด</button>}>
        <Text>รายละเอียดรายได้</Text>
      </Card>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'คอมมิชชัน' });
    const group = heading.parentElement!;
    expect(group).toHaveClass(textStyles.stack, textStyles.gap_related);
    expect(group).toContainElement(screen.getByText('ยอดที่ยืนยันแล้ว'));
    expect(group).not.toContainElement(screen.getByRole('button', { name: 'ดูทั้งหมด' }));
    expect(group).not.toContainElement(screen.getByText('รายละเอียดรายได้'));
  });
});
