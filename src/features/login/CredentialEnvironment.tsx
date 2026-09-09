'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { credentialRequest, signIn } from './credential-client';

/** UI boundary: production uses HTTP; development journeys supply isolated adapters. */
export interface CredentialEnvironment {
  request: typeof credentialRequest;
  signIn: typeof signIn;
  navigate: (href: string) => void;
  token?: string;
  clearLink: () => void;
}
const defaults: CredentialEnvironment = {
  request: credentialRequest,
  signIn,
  navigate: (href) => window.location.assign(href),
  clearLink: () => window.history.replaceState(null, '', window.location.pathname),
};
const Context = createContext<CredentialEnvironment>(defaults);
export function CredentialEnvironmentProvider({
  value,
  children,
}: {
  value: CredentialEnvironment;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useCredentialEnvironment = () => useContext(Context);
