import { useId, type InputHTMLAttributes } from 'react';
import { Text } from './Text';
import styles from './forms.module.css';
export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <label className={styles.field} htmlFor={id}>
      <Text as="span" variant="label">
        {label}
      </Text>
      <input {...props} id={id} aria-describedby={hint ? id + '-hint' : undefined} />
      {hint && (
        <Text as="span" variant="caption" tone="muted" id={id + '-hint'}>
          {hint}
        </Text>
      )}
    </label>
  );
}
