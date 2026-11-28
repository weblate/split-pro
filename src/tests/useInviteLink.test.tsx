/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';

import { useInviteLink } from '~/hooks/useInviteLink';

jest.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

const group = { name: 'Trip', publicId: 'abc123' };
const link = () => `${window.location.origin}/join-group?groupId=abc123`;

const define = (key: 'share' | 'clipboard', value: unknown) =>
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });

describe('useInviteLink', () => {
  const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = jest.fn();

  const restore = (key: string, desc?: PropertyDescriptor) => {
    if (desc) {
      Object.defineProperty(navigator, key, desc);
    } else {
      delete (navigator as unknown as Record<string, unknown>)[key];
    }
  };

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    define('clipboard', { writeText });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restore('share', originalShare);
    restore('clipboard', originalClipboard);
    jest.restoreAllMocks();
  });

  const run = async () => {
    const { result } = renderHook(() => useInviteLink(group));
    await act(async () => {
      await result.current.shareInviteLink();
    });
    return result;
  };

  it('does not copy when share succeeds', async () => {
    define('share', jest.fn().mockResolvedValue(undefined));
    await run();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does not copy when the user cancels the share sheet', async () => {
    define('share', jest.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
    const result = await run();
    expect(writeText).not.toHaveBeenCalled();
    expect(result.current.isCopied).toBe(false);
  });

  it('falls back to the clipboard when share fails with another error', async () => {
    define('share', jest.fn().mockRejectedValue(new Error('no targets')));
    const result = await run();
    expect(writeText).toHaveBeenCalledWith(link());
    expect(result.current.isCopied).toBe(true);
  });

  it('copies to the clipboard when navigator.share is missing', async () => {
    define('share', undefined);
    const result = await run();
    expect(writeText).toHaveBeenCalledWith(link());
    expect(result.current.isCopied).toBe(true);
  });
});
