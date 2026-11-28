import { ArrowLeftRight } from 'lucide-react';
import { Trans } from 'next-i18next';
import { useSession } from 'next-auth/react';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { DateSelector } from '~/components/AddExpense/DateSelector';
import { CurrencyPicker } from '~/components/AddExpense/CurrencyPicker';
import {
  CurrencyConversionFields,
  useCurrencyConversionForm,
} from '~/components/Friend/CurrencyConversion';
import { EntityAvatar } from '~/components/ui/avatar';
import { Button } from '~/components/ui/button';
import { CurrencyInput } from '~/components/ui/currency-input';
import { AppDrawer } from '~/components/ui/drawer';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { isCurrencyCode, parseCurrencyCode } from '~/lib/currency';
import {
  type PairBalance,
  type SettlementSuggestion,
  buildSettlementPayload,
  convertMinorUnits,
  friendBalancesToPairBalances,
  getDefaultCounterparty,
  getPairSuggestions,
} from '~/lib/settlement';
import { cn } from '~/lib/utils';
import { useAddExpenseStore } from '~/store/addStore';
import type { MinimalBalance } from '~/types/balance.types';
import { api } from '~/utils/api';

export interface SettlementPerson {
  id: number;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  deletedAt?: Date | null;
}

/** A settlement expense being edited; a structural subset of the expense details output. */
export interface EditableSettlement {
  id: string;
  amount: bigint;
  currency: string;
  groupId: number | null;
  expenseDate: Date;
  paidBy: number;
  paidByUser: SettlementPerson;
  expenseParticipants: { userId: number; user: SettlementPerson }[];
  group?: { name: string } | null;
}

export type SettleUpContext =
  | {
      kind: 'friend';
      friend: SettlementPerson;
      balances: MinimalBalance[];
      /** Groups both people belong to, offered in the "Record in" selector. */
      sharedGroups: { id: number; name: string }[];
    }
  | {
      kind: 'group';
      groupId: number;
      members: SettlementPerson[];
      balances: PairBalance[];
      defaultCurrency?: string | null;
    }
  | { kind: 'edit'; expense: EditableSettlement };

export type SettleUpMode = 'settle' | 'convert';

/** Values to open the drawer with, e.g. from a balance row. */
export interface SettleUpInitial {
  payerId: number;
  receiverId: number;
  currency?: string;
  amount?: bigint;
  groupId?: number | null;
  mode?: SettleUpMode;
}

interface Draft {
  payerId?: number;
  receiverId?: number;
  currency: string;
  amountStr: string;
  groupId: number | null;
  mode: SettleUpMode;
  /** Key of the suggestion the user picked, used for the overpay hint and conversions. */
  suggestionKey: string | null;
  expenseDate: Date;
  /** Counts openings, so every opening starts the conversion form from scratch. */
  openCount: number;
}

/** Radix Select reserves the empty string, so "no group" needs its own value. */
const NO_GROUP = 'none';

const keyOf = (s: Pick<SettlementSuggestion, 'payerId' | 'receiverId' | 'currency' | 'groupId'>) =>
  `${s.payerId}:${s.receiverId}:${s.currency}:${s.groupId ?? 'none'}`;

/**
 * Formats an amount for the input. Some locales format a currency in a way its own parser reads
 * back differently (de JPY "1.235 ¥" parses as 1), so fall back to the plain digits then.
 */

export const SettleUpDrawer: React.FC<{
  context: SettleUpContext;
  trigger: React.ReactNode;
  initial?: SettleUpInitial;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}> = ({ context, trigger, initial, open, onOpenChange }) => {
  const { t, displayName, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { data: session } = useSession();
  const sessionUser = session?.user;
  const currentUserId = sessionUser?.id;
  const preferredCurrency = useAddExpenseStore((state) => state.currency);

  const addExpenseMutation = api.expense.addOrEditExpense.useMutation();
  const addConversionMutation = api.expense.addOrEditCurrencyConversion.useMutation();
  const apiUtils = api.useUtils();
  // Blocks a second tap before the pending state re-renders.
  const submittingRef = useRef(false);
  const isSaving = addExpenseMutation.isPending || addConversionMutation.isPending;

  const people = useMemo((): SettlementPerson[] => {
    if ('group' === context.kind) {
      return context.members;
    }
    if ('friend' === context.kind) {
      return sessionUser ? [sessionUser, context.friend] : [context.friend];
    }
    return [
      context.expense.paidByUser,
      ...context.expense.expenseParticipants
        .filter((p) => p.userId !== context.expense.paidBy)
        .map((p) => p.user),
    ];
  }, [context, sessionUser]);

  const pairBalances = useMemo((): PairBalance[] => {
    if ('group' === context.kind) {
      return context.balances;
    }
    if ('friend' === context.kind && undefined !== currentUserId) {
      return friendBalancesToPairBalances(context.balances, currentUserId);
    }
    return [];
  }, [context, currentUserId]);

  const computeDraft = (): Draft => {
    const base = {
      mode: 'settle' as const,
      suggestionKey: null,
      expenseDate: new Date(),
      openCount: 0,
    };

    if ('edit' === context.kind) {
      const { expense } = context;
      return {
        ...base,
        payerId: expense.paidBy,
        receiverId: expense.expenseParticipants.find((p) => p.userId !== expense.paidBy)?.userId,
        currency: expense.currency,
        amountStr: getCurrencyHelpersCached(expense.currency).toUIString(
          0n > expense.amount ? -expense.amount : expense.amount,
        ),
        groupId: expense.groupId,
        expenseDate: expense.expenseDate,
      };
    }

    const fallbackCurrency =
      ('group' === context.kind && isCurrencyCode(context.defaultCurrency)
        ? context.defaultCurrency
        : null) ?? preferredCurrency;
    const fixedGroupId = 'group' === context.kind ? context.groupId : null;

    if (initial) {
      const currency = initial.currency ?? fallbackCurrency;
      const groupId = 'group' === context.kind ? fixedGroupId : (initial.groupId ?? null);
      const matching = getPairSuggestions(pairBalances, initial.payerId, initial.receiverId).find(
        (s) =>
          keyOf(s) ===
          keyOf({ payerId: initial.payerId, receiverId: initial.receiverId, currency, groupId }),
      );
      return {
        ...base,
        payerId: initial.payerId,
        receiverId: initial.receiverId,
        currency,
        groupId,
        amountStr: initial.amount
          ? getCurrencyHelpersCached(currency).toUIString(initial.amount)
          : '',
        mode: matching ? (initial.mode ?? 'settle') : 'settle',
        suggestionKey: matching ? keyOf(matching) : null,
      };
    }

    const me = currentUserId;
    const other =
      'friend' === context.kind
        ? context.friend.id
        : undefined === me
          ? undefined
          : getDefaultCounterparty(pairBalances, me);
    const top =
      undefined !== me && undefined !== other
        ? getPairSuggestions(pairBalances, me, other)[0]
        : undefined;

    return {
      ...base,
      payerId: top?.payerId ?? me,
      receiverId: top?.receiverId ?? other,
      currency: top?.currency ?? fallbackCurrency,
      groupId: 'group' === context.kind ? fixedGroupId : (top?.groupId ?? null),
      amountStr: '',
    };
  };

  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const [draft, setDraft] = useState<Draft>(computeDraft);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setDraft((prev) => ({ ...computeDraft(), openCount: prev.openCount + 1 }));
    }
  }

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // A save in flight owns the drawer: closing now would let its success close a reopened draft.
      if (!next && submittingRef.current) {
        return;
      }
      if (undefined === open) {
        setInnerOpen(next);
      }
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );

  const { payerId, receiverId, currency, amountStr, groupId, suggestionKey } = draft;
  const payer = people.find((p) => p.id === payerId);
  const receiver = people.find((p) => p.id === receiverId);
  const amount = getCurrencyHelpersCached(currency).toSafeBigInt(amountStr);

  const suggestions = useMemo(
    () =>
      'edit' !== context.kind && undefined !== payerId && undefined !== receiverId
        ? getPairSuggestions(pairBalances, payerId, receiverId)
        : [],
    [context.kind, pairBalances, payerId, receiverId],
  );
  const selectedSuggestion = suggestions.find((s) => keyOf(s) === suggestionKey);
  // Convert needs a selected balance; without one the draft can only be a plain settlement.
  const mode: SettleUpMode = selectedSuggestion ? draft.mode : 'settle';

  const conversionForm = useCurrencyConversionForm({
    amount: selectedSuggestion?.amount ?? 0n,
    currency: selectedSuggestion?.currency ?? currency,
    enabled: isOpen && 'convert' === mode && Boolean(selectedSuggestion),
    resetKey: selectedSuggestion ? `${draft.openCount}:${keyOf(selectedSuggestion)}` : undefined,
  });

  const recordInGroups = useMemo(() => {
    if ('friend' !== context.kind) {
      return [];
    }
    const groups = new Map(context.sharedGroups.map((g) => [g.id, g.name]));
    context.balances.forEach((b) => {
      if (null !== b.groupId && !groups.has(b.groupId)) {
        groups.set(b.groupId, b.groupName ?? '');
      }
    });
    return [...groups.entries()].map(([id, name]) => ({ id, name }));
  }, [context]);

  const update = (changes: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...changes }));

  const onSwap = () =>
    update({ payerId: receiverId, receiverId: payerId, suggestionKey: null, mode: 'settle' });

  const onPickPerson = (side: 'payerId' | 'receiverId', id: number) => {
    const otherSide = 'payerId' === side ? 'receiverId' : 'payerId';
    update({
      [side]: id,
      // Picking the person already on the other side swaps the two.
      ...(id === draft[otherSide] ? { [otherSide]: draft[side] } : {}),
      suggestionKey: null,
      mode: 'settle',
    });
  };

  const onPickSuggestion = (s: SettlementSuggestion) =>
    update({
      payerId: s.payerId,
      receiverId: s.receiverId,
      currency: s.currency,
      amountStr: getCurrencyHelpersCached(s.currency).toUIString(s.amount),
      ...('friend' === context.kind ? { groupId: s.groupId } : {}),
      suggestionKey: keyOf(s),
    });

  const onAmountChange = useCallback(
    ({ strValue }: { strValue?: string; bigIntValue?: bigint }) => {
      if (undefined !== strValue) {
        setDraft((prev) => ({ ...prev, amountStr: strValue }));
      }
    },
    [],
  );

  const onCurrencyPick = (next: string | null) => {
    if (!next) {
      return;
    }
    // Keep the value in major units; the old string may not parse under the new currency.
    const oldAmount = amount;
    setDraft((prev) => ({
      ...prev,
      currency: next,
      amountStr:
        0n === oldAmount
          ? ''
          : getCurrencyHelpersCached(next).toUIString(
              convertMinorUnits(oldAmount, prev.currency, next),
            ),
      suggestionKey: null,
      mode: 'settle',
    }));
  };

  const onRecordInChange = (value: string) =>
    update({ groupId: NO_GROUP === value ? null : Number(value), suggestionKey: null });

  const settlementGroupId =
    'group' === context.kind
      ? context.groupId
      : 'edit' === context.kind
        ? context.expense.groupId
        : groupId;

  const canSettle =
    undefined !== payerId && undefined !== receiverId && payerId !== receiverId && 0n < amount;
  const canConvert = Boolean(selectedSuggestion) && conversionForm.isValid;

  const onSave = async () => {
    if (undefined === payerId || undefined === receiverId || submittingRef.current) {
      return;
    }

    if ('convert' === mode) {
      const data = conversionForm.getSubmitData();
      if (!selectedSuggestion || !data) {
        return;
      }
      submittingRef.current = true;
      try {
        await addConversionMutation.mutateAsync({
          ...data,
          senderId: payerId,
          receiverId,
          groupId: selectedSuggestion.groupId,
        });
      } catch (error) {
        console.error(error);
        toast.error(t('errors.currency_conversion_error'));
        submittingRef.current = false;
        return;
      }
      submittingRef.current = false;
      toast.success(t('currency_conversion.success_toast'));
      apiUtils.invalidate().catch(console.error);
      handleOpenChange(false);
      return;
    }

    if (!canSettle) {
      return;
    }
    submittingRef.current = true;
    try {
      await addExpenseMutation.mutateAsync(
        buildSettlementPayload({
          payerId,
          receiverId,
          amount,
          currency,
          groupId: settlementGroupId,
          name: t('ui.settle_up_name'),
          ...('edit' === context.kind
            ? { expenseId: context.expense.id, expenseDate: draft.expenseDate }
            : {}),
        }),
      );
    } catch (error) {
      console.error('Error while saving settlement:', error);
      toast.error(t('errors.saving_expense'));
      submittingRef.current = false;
      return;
    }
    submittingRef.current = false;
    apiUtils.invalidate().catch(console.error);
    handleOpenChange(false);
  };

  const roleOf = (person?: SettlementPerson) => (person?.id === currentUserId ? 'you' : 'other');
  // Typing an amount without tapping a suggestion still compares against the matching balance.
  const effectiveGroupId = 'group' === context.kind ? context.groupId : groupId;
  const overpayTarget =
    selectedSuggestion ??
    ('edit' === context.kind
      ? undefined
      : suggestions.find(
          (s) =>
            s.payerId === payerId &&
            s.receiverId === receiverId &&
            s.currency === currency &&
            s.groupId === effectiveGroupId,
        ));
  const overpaid =
    overpayTarget && 'settle' === mode && amount > overpayTarget.amount
      ? amount - overpayTarget.amount
      : 0n;
  const groupName =
    'edit' === context.kind
      ? context.expense.group?.name
      : 'friend' === context.kind
        ? recordInGroups.find((g) => g.id === groupId)?.name
        : undefined;

  return (
    <AppDrawer
      trigger={trigger}
      open={isOpen}
      onOpenChange={handleOpenChange}
      leftAction={t('actions.back')}
      shouldCloseOnLeftAction={false}
      leftActionOnClick={() => {
        if (!isSaving && !submittingRef.current) {
          handleOpenChange(false);
        }
      }}
      dismissible={!isSaving}
      title={'edit' === context.kind ? t('ui.settlement') : t('actions.settle_up')}
      className="h-[85vh]"
      actionTitle={t('actions.save')}
      actionDisabled={isSaving || ('convert' === mode ? !canConvert : !canSettle)}
      actionOnClick={() => void onSave()}
    >
      <div className="flex flex-col items-center gap-6 pb-6">
        {'edit' !== context.kind ? (
          <Tabs
            value={mode}
            onValueChange={(value) => update({ mode: 'convert' === value ? 'convert' : 'settle' })}
          >
            <TabsList className="grid w-56 grid-cols-2">
              <TabsTrigger value="settle">{t('settlement.mode_settle')}</TabsTrigger>
              <TabsTrigger value="convert" disabled={!selectedSuggestion}>
                {t('settlement.mode_convert')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-start gap-3">
            <PartyColumn
              currentUserId={currentUserId}
              label={t('settlement.from')}
              person={payer}
              people={people}
              selectable={'group' === context.kind}
              onPick={(id) => onPickPerson('payerId', id)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="mt-3"
              aria-label={t('settlement.swap')}
              onClick={onSwap}
              disabled={undefined === payerId || undefined === receiverId}
            >
              <ArrowLeftRight className="size-5" />
            </Button>
            <PartyColumn
              currentUserId={currentUserId}
              label={t('settlement.to')}
              person={receiver}
              people={people}
              selectable={'group' === context.kind}
              onPick={(id) => onPickPerson('receiverId', id)}
            />
          </div>
          {payer && receiver ? (
            <p data-testid="settle-up-direction" className="text-center text-sm text-gray-400">
              {t('ui.transfer', {
                senderRole: roleOf(payer),
                receiverRole: roleOf(receiver),
                sender: displayName(payer),
                receiver: displayName(receiver),
              })}
            </p>
          ) : null}
          {groupName && 'friend' !== context.kind ? (
            <p className="text-center text-xs text-gray-500">{groupName}</p>
          ) : null}
        </div>

        {'friend' === context.kind ? (
          <div className="flex items-center gap-2">
            <Label htmlFor="settle-up-record-in" className="text-sm text-gray-400">
              {t('settlement.record_in')}
            </Label>
            <Select
              value={null === groupId ? NO_GROUP : String(groupId)}
              onValueChange={onRecordInChange}
            >
              <SelectTrigger id="settle-up-record-in" size="sm" className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>{t('settlement.no_group')}</SelectItem>
                {recordInGroups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {'edit' !== context.kind && payer && receiver ? (
          <div className="flex w-full max-w-sm flex-col gap-2">
            <p className="text-xs text-gray-500 uppercase">{t('settlement.open_balances')}</p>
            {0 === suggestions.length ? (
              <p className="text-sm text-gray-400">{t('settlement.no_open_balances')}</p>
            ) : (
              suggestions.map((s) => {
                const sPayer = people.find((p) => p.id === s.payerId);
                const sReceiver = people.find((p) => p.id === s.receiverId);
                const isSelected = keyOf(s) === suggestionKey;
                const sGroupName = 'friend' === context.kind ? s.groupName : null;
                const amountText = getCurrencyHelpersCached(s.currency).toUIString(s.amount);
                const roles = { payerRole: roleOf(sPayer), receiverRole: roleOf(sReceiver) };
                const sentence = t('balance_list.pays', {
                  ...roles,
                  payer: displayName(sPayer),
                  receiver: displayName(sReceiver),
                  amount: amountText,
                });
                return (
                  <button
                    key={keyOf(s)}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={sGroupName ? `${sentence}, ${sGroupName}` : sentence}
                    onClick={() => onPickSuggestion(s)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      isSelected ? 'border-primary bg-primary/10' : 'hover:bg-muted',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span>
                        {t('ui.transfer', {
                          senderRole: roles.payerRole,
                          receiverRole: roles.receiverRole,
                          sender: displayName(sPayer),
                          receiver: displayName(sReceiver),
                        })}
                      </span>
                      {sGroupName ? (
                        <span className="truncate text-xs text-gray-500">{sGroupName}</span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 font-medium',
                        'you' === roles.receiverRole
                          ? 'text-positive'
                          : 'you' === roles.payerRole
                            ? 'text-negative'
                            : 'text-gray-400',
                      )}
                    >
                      {amountText}
                    </span>
                  </button>
                );
              })
            )}
            {'convert' !== mode && !selectedSuggestion && 0 < suggestions.length ? (
              <p className="text-xs text-gray-500">{t('settlement.convert_needs_balance')}</p>
            ) : null}
          </div>
        ) : null}

        {'convert' === mode && selectedSuggestion ? (
          <CurrencyConversionFields form={conversionForm} />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              {'edit' === context.kind ? (
                <Button variant="outline" className="w-[70px] text-base" disabled>
                  {currency}
                </Button>
              ) : (
                <CurrencyPicker
                  currentCurrency={isCurrencyCode(currency) ? parseCurrencyCode(currency) : null}
                  onCurrencyPick={onCurrencyPick}
                />
              )}
              <CurrencyInput
                aria-label={t('settlement.amount')}
                placeholder={t('settlement.amount')}
                currency={currency}
                strValue={amountStr}
                className="w-40 text-center text-lg"
                onValueChange={onAmountChange}
              />
            </div>
            {0n < overpaid && payer && receiver ? (
              <p className="max-w-sm text-center text-xs text-gray-500">
                <Trans
                  t={t}
                  i18nKey="settlement.overpay_hint"
                  values={{
                    payerRole: roleOf(payer),
                    receiverRole: roleOf(receiver),
                    payer: displayName(payer),
                    receiver: displayName(receiver),
                  }}
                  components={{
                    amount: (
                      <span
                        className={
                          'you' === roleOf(payer)
                            ? 'text-positive'
                            : 'you' === roleOf(receiver)
                              ? 'text-negative'
                              : 'text-gray-400'
                        }
                      >
                        {getCurrencyHelpersCached(currency).toUIString(overpaid)}
                      </span>
                    ),
                  }}
                />
              </p>
            ) : null}
            {'edit' === context.kind ? (
              <DateSelector
                mode="single"
                required
                selected={draft.expenseDate}
                onSelect={(date: Date) => update({ expenseDate: date })}
                popoverPortalled={false}
              />
            ) : null}
          </div>
        )}
      </div>
    </AppDrawer>
  );
};

const PartyColumn: React.FC<{
  currentUserId?: number;
  label: string;
  person?: SettlementPerson;
  people: SettlementPerson[];
  selectable: boolean;
  onPick: (id: number) => void;
}> = ({ currentUserId, label, person, people, selectable, onPick }) => {
  const { t, displayName } = useTranslationWithUtils();

  return (
    <div className="flex w-28 flex-col items-center gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      <EntityAvatar entity={person} size={40} />
      {selectable ? (
        <Select value={person ? String(person.id) : ''} onValueChange={(v) => onPick(Number(v))}>
          <SelectTrigger size="sm" aria-label={label} className="w-28 justify-center">
            <SelectValue placeholder={t('settlement.select_person')} />
          </SelectTrigger>
          <SelectContent>
            {people.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {displayName(p, currentUserId)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="max-w-28 truncate text-sm">{displayName(person, currentUserId)}</span>
      )}
    </div>
  );
};
