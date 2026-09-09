import { z } from 'zod';

export const normalizeUsername = (value: string) => value.trim().toLowerCase();
export const Username = z
  .string()
  .max(100)
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .min(3)
      .max(30)
      .regex(/^[a-z0-9_.]+$/),
  );
// Do not trim/normalize passwords: password managers must round-trip them exactly.
export const NewPassword = z.string().min(12).max(128);
export const CredentialLogin = z.strictObject({
  username: Username,
  password: z.string().min(1).max(128),
  callbackURL: z.string().optional(),
  rememberMe: z.boolean().optional(),
});
