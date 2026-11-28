import type { BalanceView, User } from '@prisma/client';
import { Trans } from 'next-i18next';
import { clsx } from 'clsx';
import { Fragment, useMemo } from 'react';
import { EntityAvatar } from '~/components/ui/avatar';
import { api } from '~/utils/api';
import { BigMath } from '~/utils/numbers';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import type { SettleUpInitial } from '../Settlement/SettleUpDrawer';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Button } from '../ui/button';
import { CurrencyConversionIcon, SettleupIcon } from '../ui/categoryIcons';

interface UserWithBalance {
  user: User;
  total: Record<string, bigint>;
  balances: Record<number, Record<string, bigint>>;
}

export const BalanceList: React.FC<{
  groupBalances?: BalanceView[];
  users?: User[];
  /** Opens the settle-up drawer prefilled with a balance row. */
  onSettle?: (initial: SettleUpInitial) => void;
}> = ({ groupBalances = [], users = [], onSettle }) => {
  const { displayName, t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const userQuery = api.user.me.useQuery();

  const userMap = useMemo(() => {
    const res = users.reduce<Record<number, UserWithBalance>>((acc, user) => {
      acc[user.id] = { user, balances: {}, total: {} };
      return acc;
    }, {});
    groupBalances
      .filter(({ amount, userId, friendId }) =>
        Boolean(0 < BigMath.abs(amount) && userId !== friendId && res[userId] && res[friendId]),
      )
      .forEach((balance) => {
        const userBalance = res[balance.userId];
        if (!userBalance) {
          return;
        }
        if (!userBalance.balances[balance.friendId]) {
          userBalance.balances[balance.friendId] = {};
        }
        const friendBalance = userBalance.balances[balance.friendId]!;
        friendBalance[balance.currency] = (friendBalance[balance.currency] ?? 0n) + balance.amount;

        userBalance.total[balance.currency] =
          (userBalance.total[balance.currency] ?? 0n) + balance.amount;
      });

    return res;
  }, [groupBalances, users]);

  return (
    <Accordion type="multiple">
      {Object.values(userMap).map(({ user, total, balances }) => {
        let totalAmount: [string, bigint] = ['', 0n];
        const isCurrentUser = userQuery.data?.id === user.id;

        Object.entries(total).forEach(([currency, amount]) => {
          if (BigMath.abs(amount) > BigMath.abs(totalAmount[1])) {
            totalAmount = [currency, amount];
          }
        });

        return (
          <AccordionItem key={user.id} value={displayName(user)}>
            <AccordionTrigger className="overflow-hidden hover:no-underline">
              <div className="mr-2 flex min-w-0 flex-1 items-center gap-3">
                <EntityAvatar entity={user} />
                <div className="text-foreground line-clamp-2 min-w-0 break-words">
                  {Object.values(total).every((amount) => 0n === amount) ? (
                    <span className="text-gray-400">
                      {t('expense_details.balance_list.settled', {
                        actor: isCurrentUser ? 'you' : 'other',
                        person: displayName(user),
                      })}
                    </span>
                  ) : (
                    <span className="text-gray-400">
                      <Trans
                        t={t}
                        i18nKey={`expense_details.balance_list.${0 < totalAmount[1] ? 'lent_amount' : 'owes_amount'}`}
                        values={{ actor: isCurrentUser ? 'you' : 'other' }}
                        components={{
                          person: <span className="text-gray-400">{displayName(user)}</span>,
                          amount: (
                            <span
                              className={clsx(
                                'text-right',
                                0 < totalAmount[1] ? 'text-emerald-500' : 'text-orange-600',
                              )}
                            >
                              {getCurrencyHelpersCached(totalAmount[0]).toUIString(
                                BigMath.abs(totalAmount[1]),
                              )}
                            </span>
                          ),
                        }}
                      />
                    </span>
                  )}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              {Object.entries(balances).map(([friendId, perFriendBalances]) => {
                const friendBalance = userMap[Number(friendId)];
                if (!friendBalance) {
                  return null;
                }
                const friend = friendBalance.user;

                return (
                  <Fragment key={friendId}>
                    {Object.entries(perFriendBalances).map(([currency, amount]) => {
                      if (0n === amount) {
                        return null;
                      }

                      const sender = 0 < amount ? friend : user;
                      const receiver = 0 < amount ? user : friend;

                      const initial: SettleUpInitial = {
                        payerId: sender.id,
                        receiverId: receiver.id,
                        currency,
                        amount: BigMath.abs(amount),
                      };

                      return (
                        <div
                          key={friendId + currency}
                          className="flex h-12 w-full items-center justify-between border-t-2"
                        >
                          <div className="ml-5 flex cursor-pointer items-center gap-3 text-sm">
                            <EntityAvatar entity={friend} size={20} />
                            <div className="text-foreground">
                              <Trans
                                t={t}
                                i18nKey={
                                  0 < amount
                                    ? 'balance_list.pays_amount'
                                    : 'balance_list.gets_amount'
                                }
                                values={{
                                  payerRole:
                                    (0 < amount ? friend : user).id === userQuery.data?.id
                                      ? 'you'
                                      : 'other',
                                  receiverRole:
                                    (0 < amount ? user : friend).id === userQuery.data?.id
                                      ? 'you'
                                      : 'other',
                                  payer: displayName(0 < amount ? friend : user),
                                  receiver: displayName(0 < amount ? user : friend),
                                }}
                                components={{
                                  amount: (
                                    <span
                                      className={clsx(
                                        'text-right',
                                        0 < amount ? 'text-emerald-500' : 'text-orange-600',
                                      )}
                                    >
                                      {getCurrencyHelpersCached(currency).toUIString(
                                        BigMath.abs(amount),
                                      )}
                                    </span>
                                  ),
                                }}
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="icon"
                              variant="secondary"
                              className="size-8"
                              aria-label={t('actions.settle_up')}
                              disabled={!onSettle}
                              onClick={() => onSettle?.({ ...initial, mode: 'settle' })}
                            >
                              <SettleupIcon className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="secondary"
                              className="size-8"
                              aria-label={t('currency_conversion.title')}
                              disabled={!onSettle}
                              onClick={() => onSettle?.({ ...initial, mode: 'convert' })}
                            >
                              <CurrencyConversionIcon className="size-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
};
