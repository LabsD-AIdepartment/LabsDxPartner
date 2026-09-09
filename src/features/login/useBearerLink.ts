'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useCredentialEnvironment } from './CredentialEnvironment';
import { InviteToken } from '@/contracts/invitations';
import { credentialErrorText } from './credential-client';
/** Fragment stays out of HTTP URLs, referrers and server page props. Never persist it in storage. */
export function useBearerLink<T>(path: string, schema: z.ZodType<T>) {
  const { request, token: injectedToken } = useCredentialEnvironment();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    if (injectedToken !== undefined) {
      setState({});
      setToken(injectedToken);
      return;
    }
    const read = () => {
      setState({});
      setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [injectedToken]);
  useEffect(() => {
    if (token === null) return;
    const parsed = InviteToken.safeParse(token);
    if (!parsed.success) {
      setState({ error: 'กรุณาเปิดลิงก์ที่ผู้ดูแล Labs D ส่งให้ครบทั้งลิงก์' });
      return;
    }
    const controller = new AbortController();
    setState({});
    request(path, { token }, schema, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ error: credentialErrorText(error) });
      });
    return () => controller.abort();
  }, [token, path, schema, request]);
  return { token: token ?? '', ...state };
}
export function clearBearerLink() {
  window.history.replaceState(null, '', window.location.pathname);
}
