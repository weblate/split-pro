import { QueryClientProvider } from '@tanstack/react-query';
import { type RenderOptions, render } from '@testing-library/react';
import type { Session } from 'next-auth';
import { SessionContext } from 'next-auth/react';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { ThemeProvider } from 'next-themes';
import React from 'react';
import { I18nextProvider } from 'react-i18next';

import { CurrencyHelpersProvider } from '~/contexts/CurrencyHelpersContext';
import { testI18n } from './i18n';
import { createTestQueryClient } from './queryClient';
import { createMockRouter } from './router';
import { createMockSession, createTestSession } from './session';

export interface AppRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  session?: Session | null;
  sessionLoading?: boolean;
  router?: NextRouter;
}

export const renderWithProviders = (ui: React.ReactElement, options: AppRenderOptions = {}) => {
  const {
    session = createTestSession(),
    sessionLoading = false,
    router = createMockRouter(),
    ...renderOptions
  } = options;
  const queryClient = createTestQueryClient();
  const Wrapper = ({ children }: React.PropsWithChildren) => (
    <RouterContext.Provider value={router}>
      <SessionContext.Provider value={createMockSession(session, sessionLoading)}>
        <QueryClientProvider client={queryClient}>
          <CurrencyHelpersProvider>
            <ThemeProvider attribute="class" defaultTheme="dark">
              {/* `Trans` needs an i18next instance from context to render translation markup. */}
              <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>
            </ThemeProvider>
          </CurrencyHelpersProvider>
        </QueryClientProvider>
      </SessionContext.Provider>
    </RouterContext.Provider>
  );
  return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), router, queryClient };
};
