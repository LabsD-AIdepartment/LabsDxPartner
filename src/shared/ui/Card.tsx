import type { ReactNode, HTMLAttributes } from 'react';
import styles from './ui.module.css';
export function Card({
  title,
  description,
  action,
  children,
  className = '',
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <article className={`${styles.card} ${className}`} {...props}>
      {title && (
        <div className={styles.heading}>
          <div>
            <h2>{title}</h2>
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </article>
  );
}
