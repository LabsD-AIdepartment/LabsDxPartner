import type { ComponentPropsWithRef } from 'react';
import styles from './ui.module.css';
export function Button({
  variant = 'secondary',
  icon = false,
  className = '',
  type = 'button',
  ...props
}: ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary';
  icon?: boolean;
}) {
  return (
    <button
      type={type}
      className={[
        styles.button,
        variant === 'primary' ? styles.primary : '',
        icon ? styles.icon : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}
