import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';

/** Shares a group's join link through the system share sheet, or copies it where sharing is unavailable. */
export const useInviteLink = (group?: { name: string; publicId: string } | null) => {
  const { t } = useTranslationWithUtils();
  const [isCopied, setIsCopied] = useState(false);

  const copyInviteLink = useCallback(
    async (inviteLink: string) => {
      try {
        await navigator.clipboard.writeText(inviteLink);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (error) {
        console.error('Error copying invite link', error);
        toast.error(t('errors.something_went_wrong'));
      }
    },
    [t],
  );

  const shareInviteLink = useCallback(async () => {
    if (!group) {
      return;
    }
    const inviteLink = `${window.location.origin}/join-group?groupId=${group.publicId}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${t('invite_message.join_to')} ${group.name} ${t('invite_message.in_splitpro')}`,
          text: t('invite_message.text'),
          url: inviteLink,
        });
      } catch (error) {
        // The user dismissed the share sheet; nothing to do.
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('Error sharing', error);
        await copyInviteLink(inviteLink);
      }
      return;
    }

    await copyInviteLink(inviteLink);
  }, [group, t, copyInviteLink]);

  return { shareInviteLink, isCopied };
};
