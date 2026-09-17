import styles from './bilingual-tagline.module.css';

/** One typographic group; translations share sizing and wrap together on small screens. */
export function BilingualTagline({ english, thai }: { english: string; thai: string }) {
  return (
    <p className={styles.tagline}>
      <span lang="en">{english}</span>
      <span lang="th">{thai}</span>
    </p>
  );
}
