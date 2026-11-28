import { HandCoins, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

import { Button, type ButtonProps } from '~/components/ui/button';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';

/** The "Settle up" button, passed as a drawer trigger so it has to forward its props and ref. */
export const SettleUpButton = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
  const { t } = useTranslationWithUtils();
  return (
    <Button ref={ref} size="sm" variant="secondary" responsiveIcon {...props}>
      <HandCoins className="size-4 text-gray-400" /> {t('actions.settle_up')}
    </Button>
  );
});
SettleUpButton.displayName = 'SettleUpButton';

/**
 * The action row shared by friend and group pages: Add expense first as the primary action,
 * then Settle up, then a page-specific action such as Export or Add members.
 */
export const EntityActions: React.FC<{
  addExpenseHref: string;
  addExpenseDisabled?: boolean;
  settleUp: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
}> = ({ addExpenseHref, addExpenseDisabled, settleUp, extra, className }) => {
  const { t } = useTranslationWithUtils();

  return (
    <div className={className ?? 'mt-6 mb-4 flex justify-center gap-2'}>
      {addExpenseDisabled ? (
        <Button size="sm" className="w-40 gap-1 text-sm lg:w-[180px]" disabled>
          <PlusIcon className="size-4" /> {t('actions.add_expense')}
        </Button>
      ) : (
        <Button size="sm" className="w-40 gap-1 text-sm lg:w-[180px]" asChild>
          <Link href={addExpenseHref}>
            <PlusIcon className="size-4" /> {t('actions.add_expense')}
          </Link>
        </Button>
      )}
      {settleUp}
      {extra}
    </div>
  );
};
