'use client';
import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Text } from './Text';
import { Button } from './Button';
import styles from './forms.module.css';
export function PasswordField({
  label,
  hint,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; hint?: string }) {
  const id = useId(),
    [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>
        <Text as="span" variant="label">
          {label}
        </Text>
      </label>
      <div className={styles.passwordControl}>
        <input
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={hint ? id + '-hint' : undefined}
        />
        <Button
          icon
          aria-label={`${visible ? 'ซ่อน' : 'แสดง'}${label}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          <Icon size={20} aria-hidden />
        </Button>
      </div>
      {hint && (
        <Text as="span" variant="caption" tone="muted" id={id + '-hint'}>
          {hint}
        </Text>
      )}
    </div>
  );
}
