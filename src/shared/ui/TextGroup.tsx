import { createElement, type ComponentPropsWithoutRef } from 'react';
import styles from './text.module.css';

type GroupTag = 'div' | 'span';
type TextGroupProps<T extends GroupTag> = {
  as?: T;
  layout?: 'stack' | 'inline';
  spacing?: 'tight' | 'related';
} & ComponentPropsWithoutRef<T>;

/** Related text only. Page sections, controls and card grids retain their own spacing.
 * Use `as="span"` inside phrasing-only containers; its children must also be phrasing content.
 */
export function TextGroup<T extends GroupTag = 'div'>({
  as,
  layout = 'stack',
  spacing = 'related',
  className = '',
  ...props
}: TextGroupProps<T>) {
  return createElement(as ?? 'div', {
    ...props,
    className: `${styles.group} ${styles[layout]} ${styles[`gap_${spacing}`]} ${className}`,
  });
}
