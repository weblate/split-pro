import { SplitType } from '@prisma/client';

import {
  type PairBalance,
  buildSettlementPayload,
  convertMinorUnits,
  friendBalancesToPairBalances,
  getDefaultCounterparty,
  getPairSuggestions,
} from '~/lib/settlement';

const row = (
  userId: number,
  friendId: number,
  amount: bigint,
  currency = 'USD',
  groupId: number | null = 7,
): PairBalance => ({ userId, friendId, amount, currency, groupId, groupName: 'Trip' });

/** Balance views store both directions, so build the mirrored pair. */
const both = (userId: number, friendId: number, amount: bigint, currency = 'USD') => [
  row(userId, friendId, amount, currency),
  row(friendId, userId, -amount, currency),
];

describe('getPairSuggestions', () => {
  it('turns a balance into the transfer that settles it', () => {
    expect(getPairSuggestions(both(1, 2, 1250n), 1, 2)).toEqual([
      {
        payerId: 2,
        receiverId: 1,
        amount: 1250n,
        currency: 'USD',
        groupId: 7,
        groupName: 'Trip',
      },
    ]);
  });

  it('gives the same suggestion whichever side is asked first', () => {
    const balances = both(1, 2, -800n);
    expect(getPairSuggestions(balances, 2, 1)).toEqual(getPairSuggestions(balances, 1, 2));
  });

  it('uses mirrored rows when only the other direction exists', () => {
    expect(getPairSuggestions([row(2, 1, 500n)], 1, 2)).toEqual([
      expect.objectContaining({ payerId: 1, receiverId: 2, amount: 500n }),
    ]);
  });

  it('lists each currency and group separately, largest first, and skips zero balances', () => {
    const balances = [
      ...both(1, 2, 300n, 'EUR'),
      ...both(1, 2, -900n, 'USD'),
      ...both(1, 2, 0n, 'PLN'),
      ...both(1, 3, 5000n),
    ];
    expect(getPairSuggestions(balances, 1, 2)).toEqual([
      expect.objectContaining({ currency: 'USD', payerId: 1, receiverId: 2, amount: 900n }),
      expect.objectContaining({ currency: 'EUR', payerId: 2, receiverId: 1, amount: 300n }),
    ]);
  });

  it('returns nothing for the same person on both sides', () => {
    expect(getPairSuggestions(both(1, 2, 100n), 1, 1)).toEqual([]);
  });
});

describe('getDefaultCounterparty', () => {
  it('picks the person with the largest open balance in either direction', () => {
    const balances = [...both(1, 2, 300n), ...both(1, 3, -700n), ...both(2, 3, 9000n)];
    expect(getDefaultCounterparty(balances, 1)).toBe(3);
  });

  it('returns undefined when everything is settled', () => {
    expect(getDefaultCounterparty(both(1, 2, 0n), 1)).toBeUndefined();
  });
});

describe('friendBalancesToPairBalances', () => {
  it('tags friend balances with the current user', () => {
    expect(
      friendBalancesToPairBalances(
        [{ friendId: 2, currency: 'USD', amount: 100n, groupId: null }],
        1,
      ),
    ).toEqual([
      { userId: 1, friendId: 2, currency: 'USD', amount: 100n, groupId: null, groupName: null },
    ]);
  });
});

describe('buildSettlementPayload', () => {
  it('records the payer paying the receiver', () => {
    expect(
      buildSettlementPayload({
        payerId: 1,
        receiverId: 2,
        amount: 500n,
        currency: 'EUR',
        groupId: null,
        name: 'Settle up',
      }),
    ).toEqual(
      expect.objectContaining({
        amount: 500n,
        currency: 'EUR',
        paidBy: 1,
        groupId: null,
        splitType: SplitType.SETTLEMENT,
        participants: [
          { userId: 1, amount: 500n },
          { userId: 2, amount: -500n },
        ],
      }),
    );
  });

  it('keeps the expense id and date when editing', () => {
    const expenseDate = new Date('2026-01-02');
    expect(
      buildSettlementPayload({
        payerId: 1,
        receiverId: 2,
        amount: 1n,
        currency: 'USD',
        groupId: 3,
        name: 'Settle up',
        expenseId: 'abc',
        expenseDate,
      }),
    ).toEqual(expect.objectContaining({ expenseId: 'abc', expenseDate }));
  });
});

describe('convertMinorUnits', () => {
  it('keeps the major-unit value across different decimal precisions', () => {
    expect(convertMinorUnits(123456n, 'USD', 'JPY')).toBe(1235n);
    expect(convertMinorUnits(1235n, 'JPY', 'USD')).toBe(123500n);
    expect(convertMinorUnits(1234n, 'USD', 'USD')).toBe(1234n);
  });

  it('rounds half up when the target has fewer decimals', () => {
    expect(convertMinorUnits(149n, 'USD', 'JPY')).toBe(1n);
    expect(convertMinorUnits(150n, 'USD', 'JPY')).toBe(2n);
    expect(convertMinorUnits(0n, 'USD', 'JPY')).toBe(0n);
  });
});
