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
export const passwordPolicy = { minLength: 8, maxLength: 128 } as const;
export const NewPassword = z.string().min(passwordPolicy.minLength).max(passwordPolicy.maxLength);
export const CredentialLogin = z.strictObject({
  username: Username,
  password: z.string().min(1).max(passwordPolicy.maxLength),
  callbackURL: z.string().optional(),
  rememberMe: z.boolean().optional(),
});
