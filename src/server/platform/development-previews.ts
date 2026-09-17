/** Mockup routes are opt-in, including when the real application runs in dev mode. */
export function developmentPreviewsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' && env.LABSD_DEVELOPMENT_PREVIEWS_ENABLED === '1';
}
