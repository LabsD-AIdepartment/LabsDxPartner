'use client';
import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Text } from './Text';
import { Button } from './Button';
import { estimatePasswordStrength } from './password-strength';
import styles from './forms.module.css';
export function PasswordField({
  label,
  hint,
  error,
  showStrength = false,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  hint?: string;
  error?: string;
  showStrength?: boolean;
}) {
  const id = useId(),
    [visible, setVisible] = useState(false);
  const [estimate, setEstimate] = useState(() =>
    estimatePasswordStrength(String(props.defaultValue ?? '')),
  );
  const strength =
    props.value !== undefined ? estimatePasswordStrength(String(props.value)) : estimate;
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
          onChange={(event) => {
            if (showStrength) setEstimate(estimatePasswordStrength(event.target.value));
            onChange?.(event);
          }}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={
            [
              hint ? id + '-hint' : '',
              showStrength ? id + '-strength' : '',
              error ? id + '-error' : '',
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
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
      {error && (
        <Text as="span" role="alert" id={id + '-error'}>
          {error}
        </Text>
      )}
      {hint && (
        <Text as="span" variant="caption" tone="muted" id={id + '-hint'}>
          {hint}
        </Text>
      )}
      {showStrength && (
        <div className={styles.passwordStrength} id={id + '-strength'}>
          <div
            className={styles.strengthTrack}
            role="meter"
            aria-label="ความแข็งแรงของรหัสผ่านโดยประมาณ"
            aria-valuemin={0}
            aria-valuemax={3}
            aria-valuenow={strength.level}
            aria-valuetext={strength.label}
            data-level={strength.level}
          >
            {[1, 2, 3].map((level) => (
              <span key={level} data-filled={level <= strength.level} />
            ))}
          </div>
          <Text as="span" variant="caption" tone="muted">
            ระดับโดยประมาณ: {strength.label}
          </Text>
          {strength.hint && (
            <Text as="span" variant="caption" tone="muted">
              {strength.hint}
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
