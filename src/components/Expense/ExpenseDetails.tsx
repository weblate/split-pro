import { isSameDay } from 'date-fns';
import { type User as NextUser } from 'next-auth';
import { Trans } from 'next-i18next';

import type { inferRouterOutputs } from '@trpc/server';
import { Landmark, Merge, PencilIcon, Users } from 'lucide-react';
import Link from 'next/link';
import React, { type ComponentProps, useCallback } from 'react';
import { toast } from 'sonner';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { isCurrencyCode } from '~/lib/currency';
import { getParticipantShare, hasShareBreakdown } from '~/lib/expenseShare';
import type { ExpenseRouter } from '~/server/api/routers/expense';
import { useAddExpenseStore } from '~/store/addStore';
import { api } from '~/utils/api';

import { CurrencyConversion } from '../Friend/CurrencyConversion';
import { EntityAvatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { CategoryIcon } from '../ui/categoryIcons';
import { Separator } from '../ui/separator';
import { ExpenseComments } from './ExpenseComments';
import { Receipt } from './Receipt';
import { RecurrencePreview } from './RecurrencePreview';
import { SettleUpDrawer } from '../Settlement/SettleUpDrawer';

type ExpenseDetailsOutput = NonNullable<inferRouterOutputs<ExpenseRouter>['getExpenseDetails']>;

interface ExpenseDetailsProps {
  user: NextUser;
  expense: ExpenseDetailsOutput;
}

const ExpenseDetails: React.FC<ExpenseDetailsProps> = ({ user, expense }) => {
  const { displayName, toUIDate, t, getCurrencyHelpersCached } = useTranslationWithUtils();

  const { toUIString } = getCurrencyHelpersCached(expense.currency);
  const showShareBreakdown = hasShareBreakdown(expense);

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="flex items-start gap-4">
          <div className="rounded-lg border p-2 text-xl">
            <CategoryIcon category={expense.category} className="text-gray-400" size={24} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex w-full items-center gap-2">
              <p>{expense.name}</p>
              {expense.transactionId && <Landmark className="text-positive h-4 w-4" />}
            </div>
            <p className="text-2xl font-semibold">{toUIString(expense.amount)}</p>
            {!isSameDay(expense.expenseDate, expense.createdAt) ? (
              <p className="text-sm text-gray-500">
                {toUIDate(expense.expenseDate, { year: true })}
              </p>
            ) : null}
            {expense.updatedByUser ? (
              <p className="text-sm text-gray-500">
                {t('expense_metadata.edited_by', {
                  actor: expense.updatedByUser.id === user.id ? 'you' : 'other',
                  user: displayName(expense.updatedByUser),
                  date: toUIDate(expense.updatedAt, { year: true }),
                })}
              </p>
            ) : null}
            {expense.deletedByUser ? (
              <p className="text-negative text-sm">
                {t('expense_metadata.deleted_by', {
                  actor: expense.deletedByUser.id === user.id ? 'you' : 'other',
                  user: displayName(expense.deletedByUser),
                  date: toUIDate(expense.deletedAt ?? expense.createdAt, { year: true }),
                })}
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                {t('expense_metadata.added_by', {
                  actor: expense.addedByUser.id === user.id ? 'you' : 'other',
                  user: displayName(expense.addedByUser),
                  date: toUIDate(expense.createdAt, { year: true }),
                })}
              </p>
            )}
            {expense.recurrence ? (
              <Link href="/recurring" className="text-primary text-sm hover:underline">
                <RecurrencePreview schedule={expense.recurrence.job.schedule} />
              </Link>
            ) : null}
            {expense.group ? (
              <Link href={`/groups/${expense.group.id}`}>
                <Button variant="outline" size="sm" className="mt-2 gap-2">
                  <div className="relative">
                    <Users className="size-4" />
                    {expense.group.simplifyDebts && (
                      <Merge className="absolute -top-1 -right-1 size-2" />
                    )}
                  </div>
                  {expense.group.name}
                </Button>
              </Link>
            ) : null}
          </div>
        </div>
        <div>{expense.fileKey ? <Receipt fileKey={expense.fileKey} /> : null}</div>
      </div>
      <Separator />
      <div className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Trans
          t={t}
          i18nKey={
            0n > expense.amount ? 'expense_participant.received' : 'expense_participant.paid'
          }
          values={{ actor: expense.paidByUser.id === user.id ? 'you' : 'other' }}
          components={{
            person: (
              <Link
                href={
                  expense.paidByUser.id === user.id
                    ? '/balances'
                    : `/balances/${expense.paidByUser.id}`
                }
              >
                <Button variant="outline" size="sm" className="gap-2 px-2">
                  <EntityAvatar entity={expense.paidByUser} size={25} />
                  <span>{displayName(expense.paidByUser, user.id)}</span>
                </Button>
              </Link>
            ),
            amount: (
              <span className={0n < expense.amount ? 'text-negative' : 'text-positive'}>
                {toUIString(expense.amount)}
              </span>
            ),
          }}
        />
      </div>
      <div className="mt-4 ml-14 flex flex-col gap-4">
        {expense.expenseParticipants
          .filter((participant) => 0n !== participant.amount)
          .map((participant) => (
            <ExpenseParticipantEntry
              key={participant.userId}
              participant={participant}
              userId={user.id}
              currency={expense.currency}
              payerShare={
                showShareBreakdown && participant.userId === expense.paidBy
                  ? getParticipantShare(participant, expense)
                  : undefined
              }
            />
          ))}
        {expense.conversionTo && (
          <>
            {expense.conversionTo.expenseParticipants
              .filter((participant) => 0n !== participant.amount)
              .map((participant) => (
                <ExpenseParticipantEntry
                  key={participant.userId}
                  participant={participant}
                  userId={user.id}
                  currency={expense.conversionTo!.currency}
                />
              ))}
          </>
        )}
      </div>
      <ExpenseComments expense={expense} userId={user.id} />
    </>
  );
};

const ExpenseParticipantEntry: React.FC<{
  participant: ExpenseDetailsOutput['expenseParticipants'][number];
  userId: number;
  currency: string;
  /** The payer's own share, shown alongside what they get back. Omitted for everyone else. */
  payerShare?: bigint;
}> = ({ participant, userId, currency, payerShare }) => {
  const { displayName, t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { toUIString } = getCurrencyHelpersCached(currency);

  const isCurrentUser = userId === participant.userId;
  const isPositive = participant.amount > 0n;
  const amountColorClass = isPositive ? 'text-positive' : 'text-negative';
  const hasPayerShare = undefined !== payerShare && 0n < payerShare;

  const getI18nKey = () => {
    if (hasPayerShare && isPositive) {
      return 'expense_participant.owes_and_gets';
    }
    return isPositive ? 'expense_participant.gets' : 'expense_participant.owes';
  };

  return (
    <div key={participant.userId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Trans
        t={t}
        i18nKey={getI18nKey()}
        values={{ actor: isCurrentUser ? 'you' : 'other' }}
        components={{
          person: (
            <Link href={isCurrentUser ? '/balances' : `/balances/${participant.userId}`}>
              <Button variant="outline" size="sm" className="gap-2 px-2">
                <EntityAvatar entity={participant.user} size={25} />
                <span>{displayName(participant.user, userId)}</span>
              </Button>
            </Link>
          ),
          amount: <span className={amountColorClass}>{toUIString(participant.amount)}</span>,
          share: <span className="text-negative">{toUIString(payerShare ?? 0n)}</span>,
        }}
      />
    </div>
  );
};

export const EditCurrencyConversion: React.FC<{ expense: ExpenseDetailsOutput }> = ({
  expense,
}) => {
  const { setCurrency } = useAddExpenseStore((s) => s.actions);
  const { t } = useTranslationWithUtils();

  const addOrEditCurrencyConversionMutation = api.expense.addOrEditCurrencyConversion.useMutation();
  const apiUtils = api.useUtils();

  const hasConversionTo = Boolean(expense.conversionTo);
  if (!hasConversionTo) {
    toast.error(t('errors.currency_conversion_malformed'));
    console.error(
      'Malformed currency conversion data: no conversionTo present, please report this issue.',
    );
  }

  const onClick = useCallback(() => {
    if (expense.conversionTo && isCurrencyCode(expense.conversionTo.currency)) {
      setCurrency(expense.conversionTo.currency);
    }
  }, [expense, setCurrency]);

  const sender = expense.paidByUser;
  const receiver = expense.expenseParticipants.find((p) => p.userId !== expense.paidBy)?.user;

  const onSubmit: ComponentProps<typeof CurrencyConversion>['onSubmit'] = useCallback(
    async (data) => {
      if (!sender || !receiver) {
        return;
      }
      await addOrEditCurrencyConversionMutation.mutateAsync({
        ...data,
        senderId: sender.id,
        receiverId: receiver.id,
        groupId: expense.groupId,
        expenseId: expense.id,
      });
      await apiUtils.invalidate();
    },
    [addOrEditCurrencyConversionMutation, sender, receiver, expense.groupId, expense.id, apiUtils],
  );

  if (!hasConversionTo || !sender || !receiver || !isCurrencyCode(expense.currency)) {
    return null;
  }

  return (
    <CurrencyConversion
      amount={expense.amount}
      currency={expense.currency}
      onSubmit={onSubmit}
      editingRate={Math.abs(Number(expense.conversionTo?.amount) / Number(expense.amount))}
    >
      <Button variant="ghost" onClick={onClick}>
        <PencilIcon className="mr-1 h-4 w-4" />
      </Button>
    </CurrencyConversion>
  );
};

export const EditSettlement: React.FC<{ expense: ExpenseDetailsOutput }> = ({ expense }) => {
  const hasReceiver = expense.expenseParticipants.some((p) => p.userId !== expense.paidBy);
  if (!hasReceiver) {
    return null;
  }

  return (
    <SettleUpDrawer
      context={{ kind: 'edit', expense }}
      trigger={
        <Button variant="ghost">
          <PencilIcon className="mr-1 h-4 w-4" />
        </Button>
      }
    />
  );
};

export default ExpenseDetails;
