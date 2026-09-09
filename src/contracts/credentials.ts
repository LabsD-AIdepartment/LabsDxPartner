import { z } from 'zod';

export const normalizeUsername = (value: string) => value.trim().toLowerCase();
export const usernameHint = 'ใช้ภาษาไทย อังกฤษ ตัวเลข จุด หรือ _ จำนวน 3–30 ตัว ไม่เว้นวรรค';
export const Username = z
  .string()
  .max(100)
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .min(3, usernameHint)
      .max(30, usernameHint)
      .regex(/^[a-z0-9_.\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59]+$/, usernameHint),
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
