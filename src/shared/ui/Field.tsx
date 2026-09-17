import { useId, type InputHTMLAttributes } from 'react';
import { Text } from './Text';
import { TextGroup } from './TextGroup';
import styles from './forms.module.css';
export function Field({
  label,
  hint,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <label className={styles.field} htmlFor={id}>
      <Text as="span" variant="label">
        {label}
      </Text>
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={
          [hint ? id + '-hint' : '', error ? id + '-error' : ''].filter(Boolean).join(' ') ||
          undefined
        }
      />
      {(error || hint) && (
        <TextGroup as="span" spacing="tight">
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
        </TextGroup>
      )}
    </label>
  );
}
