import { createElement, type ComponentPropsWithoutRef } from 'react';
import styles from './text.module.css';

export type TextVariant = 'body' | 'caption' | 'label' | 'cardTitle' | 'sectionTitle';
export type TextLeading = 'body' | 'compact' | 'heading' | 'reading';
type TextTag = 'p' | 'span' | 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'strong' | 'small' | 'label';
type TextProps<T extends TextTag> = {
  as?: T;
  variant?: TextVariant;
  tone?: 'default' | 'muted';
  leading?: TextLeading;
} & ComponentPropsWithoutRef<T>;

/** Visual role and HTML semantics are independent; do not size text in page CSS. */
export function Text<T extends TextTag = 'p'>({
  as,
  variant = 'body',
  tone = 'default',
  leading,
  className = '',
  ...props
}: TextProps<T>) {
  const Tag = as ?? 'p';
  return createElement(Tag, {
    ...props,
    className: `${styles.text} ${styles[variant]} ${styles[tone]} ${leading ? styles[`leading_${leading}`] : ''} ${className}`,
  });
}
