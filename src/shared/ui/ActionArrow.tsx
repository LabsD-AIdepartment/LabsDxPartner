import styles from './action-arrow.module.css';

/** Decorative navigation cue, sized to the smallest supported text token. */
export function ActionArrow() {
  return (
    <span className={styles.arrow} aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" focusable="false">
        <path
          d="M4.5 11.5 11.5 4.5M5 4.5h6.5V11"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
