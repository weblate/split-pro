/** @jest-environment node */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInstance } from 'i18next';

import config from '../../next-i18next.config.js';

const loadCommon = (locale: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'public/locales', locale, 'common.json'), 'utf8'),
  ) as Record<string, unknown>;

/** Builds i18next the way next-i18next does: every top-level config key except `i18n` is passed through. */
const createTranslator = async (lng: string) => {
  const { i18n: _i18n, ...options } = config;
  const instance = createInstance();
  config.onPreInitI18next!(instance);
  await instance.init({
    ...options,
    lng,
    ns: ['common'],
    defaultNS: 'common',
    resources: { [lng]: { common: loadCommon(lng) }, en: { common: loadCommon('en') } },
  });
  return instance;
};

describe('untranslated strings', () => {
  it('falls back to English when Weblate stores an untranslated string as ""', async () => {
    // The es-MX catalog keeps actions.next as an empty string.
    expect(loadCommon('es-MX')).toHaveProperty(['actions', 'next'], '');

    const instance = await createTranslator('es-MX');
    expect(instance.t('actions.next')).toBe('Next');
  });

  it('still uses a real translation when one exists', async () => {
    const instance = await createTranslator('es-MX');
    expect(instance.t('actions.cancel')).toBe('Cancelar');
  });
});
