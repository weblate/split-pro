import { SplitType } from '@prisma/client';

import { DEFAULT_CATEGORY } from '~/lib/category';
import { CURRENCIES, isCurrencyCode } from '~/lib/currency';
import type { MinimalBalance } from '~/types/balance.types';

/**
 * A directed balance row: a positive amount means `friendId` owes `userId`.
 * Matches the shape of `BalanceView`, so group balances can be passed as they are.
 */
export interface PairBalance {
  userId: number;
  friendId: number;
  currency: string;
  amount: bigint;
  groupId: number | null;
  groupName?: string | null;
}

/** An open balance between two people, phrased as the transfer that would settle it. */
export interface SettlementSuggestion {
  payerId: number;
  receiverId: number;
  currency: string;
  /** Always positive. */
  amount: bigint;
  groupId: number | null;
  groupName: string | null;
}

/** Friend balances come from the current user's perspective, so tag them with the current user. */
export const friendBalancesToPairBalances = (
  balances: MinimalBalance[],
  currentUserId: number,
): PairBalance[] =>
  balances.map(({ friendId, currency, amount, groupId, groupName }) => ({
    userId: currentUserId,
    friendId,
    currency,
    amount,
    groupId,
    groupName: groupName ?? null,
  }));

const suggestionKey = (groupId: number | null, currency: string) =>
  `${groupId ?? 'none'}:${currency}`;

/**
 * Lists the open balances between two people as transfers that would settle them, largest first.
 * Balance views hold both directions of every pair, so rows seen from `firstId` win and the
 * mirrored rows only fill in pairs that are missing.
 */
export const getPairSuggestions = (
  balances: PairBalance[],
  firstId: number,
  secondId: number,
): SettlementSuggestion[] => {
  if (firstId === secondId) {
    return [];
  }

  const totals = new Map<string, Omit<SettlementSuggestion, 'payerId' | 'receiverId'>>();
  const add = (row: PairBalance, amount: bigint, fromMirror: boolean) => {
    const key = suggestionKey(row.groupId, row.currency);
    const existing = totals.get(key);
    if (fromMirror && existing) {
      return;
    }
    totals.set(key, {
      currency: row.currency,
      groupId: row.groupId,
      groupName: row.groupName ?? null,
      amount: (existing?.amount ?? 0n) + amount,
    });
  };

  const direct = balances.filter((row) => row.userId === firstId && row.friendId === secondId);
  direct.forEach((row) => add(row, row.amount, false));

  const directKeys = new Set(direct.map((row) => suggestionKey(row.groupId, row.currency)));
  balances
    .filter(
      (row) =>
        row.userId === secondId &&
        row.friendId === firstId &&
        !directKeys.has(suggestionKey(row.groupId, row.currency)),
    )
    .forEach((row) => add(row, -row.amount, false));

  return [...totals.values()]
    .filter(({ amount }) => 0n !== amount)
    .map(({ amount, currency, groupId, groupName }) => ({
      // A positive amount from firstId's side means secondId owes firstId.
      payerId: 0n < amount ? secondId : firstId,
      receiverId: 0n < amount ? firstId : secondId,
      currency,
      amount: 0n < amount ? amount : -amount,
      groupId,
      groupName,
    }))
    .sort((a, b) => (a.amount === b.amount ? 0 : a.amount < b.amount ? 1 : -1));
};

/**
 * The person `userId` has the largest single open balance with, as a sensible default counterparty.
 * Amounts in different currencies are compared by raw value, which is good enough for a default.
 */
export const getDefaultCounterparty = (
  balances: PairBalance[],
  userId: number,
): number | undefined => {
  const best = balances.reduce<{ friendId: number; amount: bigint } | null>((acc, row) => {
    if (row.userId !== userId || row.friendId === userId || 0n === row.amount) {
      return acc;
    }
    const amount = 0n < row.amount ? row.amount : -row.amount;
    return !acc || amount > acc.amount ? { friendId: row.friendId, amount } : acc;
  }, null);
  return best?.friendId;
};

export interface SettlementDraft {
  payerId: number;
  receiverId: number;
  amount: bigint;
  currency: string;
  groupId: number | null;
  name: string;
  expenseId?: string;
  expenseDate?: Date;
}

/** Input for `expense.addOrEditExpense` that records `payerId` paying `receiverId`. */
export const buildSettlementPayload = ({
  payerId,
  receiverId,
  amount,
  currency,
  groupId,
  name,
  expenseId,
  expenseDate,
}: SettlementDraft) => ({
  ...(expenseId ? { expenseId } : {}),
  ...(expenseDate ? { expenseDate } : {}),
  name,
  currency,
  amount,
  splitType: SplitType.SETTLEMENT,
  participants: [
    { userId: payerId, amount },
    { userId: receiverId, amount: -amount },
  ],
  paidBy: payerId,
  category: DEFAULT_CATEGORY,
  groupId,
});

const decimalsOf = (currency: string) =>
  isCurrencyCode(currency) ? CURRENCIES[currency].decimalDigits : 2;

/**
 * Re-expresses an amount in minor units of `from` as minor units of `to`, keeping its value in
 * major units. Rounds half away from zero when `to` has fewer decimals.
 */
export const convertMinorUnits = (amount: bigint, from: string, to: string): bigint => {
  const diff = decimalsOf(to) - decimalsOf(from);
  if (0 === diff) {
    return amount;
  }
  if (0 < diff) {
    return amount * 10n ** BigInt(diff);
  }
  const divisor = 10n ** BigInt(-diff);
  const abs = 0n > amount ? -amount : amount;
  const rounded = (abs + divisor / 2n) / divisor;
  return 0n > amount ? -rounded : rounded;
};
