/** @jest-environment jsdom */

import { SplitType } from '@prisma/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import type { PairBalance } from '~/lib/settlement';
import { testI18n } from '~/tests/helpers/i18n';
import { renderWithProviders } from '~/tests/helpers/render';
import { createTestUser } from '~/tests/helpers/user';
import type { MinimalBalance } from '~/types/balance.types';

const mutate = jest.fn();
const mutateExpense = jest.fn().mockResolvedValue(undefined);
const mutateConversion = jest.fn().mockResolvedValue(undefined);
const invalidate = jest.fn().mockResolvedValue(undefined);
// React Query keeps query data referentially stable, and the conversion form relies on it.
const rateQuery = { isPending: false, data: { rate: 2 } };
// Mirrors React Query: isPending is true while mutateAsync is in flight.
const usePendingMutation = (
  mutateFn: jest.Mock,
  mutateAsyncFn: jest.Mock,
): {
  mutate: jest.Mock;
  mutateAsync: (...args: unknown[]) => Promise<unknown>;
  isPending: boolean;
} => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const [isPending, setPending] = (require('react') as typeof React).useState(false);
  return {
    mutate: mutateFn,
    isPending,
    mutateAsync: async (...args: unknown[]) => {
      setPending(true);
      try {
        return await mutateAsyncFn(...args);
      } finally {
        setPending(false);
      }
    },
  };
};
jest.mock('~/utils/api', () => ({
  api: {
    expense: {
      addOrEditExpense: {
        useMutation: () => usePendingMutation(mutate, mutateExpense),
      },
      addOrEditCurrencyConversion: { useMutation: () => ({ mutateAsync: mutateConversion }) },
      getCurrencyRate: { useQuery: () => rateQuery },
    },
    useUtils: () => ({ invalidate }),
  },
}));

// The real picker is a cmdk list that needs browser-only APIs; a stub is enough to change currency.
jest.mock('~/components/AddExpense/CurrencyPicker', () => ({
  CurrencyPicker: ({ onCurrencyPick }: { onCurrencyPick: (currency: string) => void }) => (
    <button onClick={() => onCurrencyPick('JPY')}>Choose JPY</button>
  ),
}));

import {
  SettleUpDrawer,
  type SettleUpContext,
  type SettleUpInitial,
} from '~/components/Settlement/SettleUpDrawer';

const me = createTestUser({ id: 1, name: 'Alex Example' });
const friend = createTestUser({ id: 2, name: 'Sam Friend', email: 'sam@example.test' });
const third = createTestUser({ id: 3, name: 'Kim Third', email: 'kim@example.test' });

const friendContext = (balances: MinimalBalance[] = []): SettleUpContext => ({
  kind: 'friend',
  friend,
  balances,
  sharedGroups: [{ id: 7, name: 'Trip' }],
});

/** Balance views hold both directions of every pair. */
const both = (
  userId: number,
  friendId: number,
  amount: bigint,
  currency = 'USD',
): PairBalance[] => [
  { userId, friendId, amount, currency, groupId: 9 },
  { userId: friendId, friendId: userId, amount: -amount, currency, groupId: 9 },
];

const groupContext = (balances: PairBalance[]): SettleUpContext => ({
  kind: 'group',
  groupId: 9,
  members: [me, friend, third],
  balances,
});

const renderDrawer = (context: SettleUpContext, initial?: SettleUpInitial) => {
  const user = userEvent.setup();
  const view = renderWithProviders(
    <SettleUpDrawer
      context={context}
      initial={initial}
      trigger={<button>Open settle up</button>}
    />,
  );
  return { user, view };
};

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Open settle up' }));
  return screen.findByRole('button', { name: 'Save' });
};

/** Opens a select by its label and picks an option by its visible text. */
const pick = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
};

const balance = (
  amount: bigint,
  currency: string,
  groupId: number,
  groupName: string,
): MinimalBalance => ({ currency, amount, friendId: 2, groupId, groupName });

/** Switches to JPY through the stubbed currency picker. */
const pickJpy = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Choose JPY' }));

const lastPayload = () => mutateExpense.mock.calls.at(-1)?.[0];

describe('SettleUpDrawer', () => {
  beforeEach(() => {
    mutate.mockClear();
    mutateExpense.mockReset().mockResolvedValue(undefined);
    mutateConversion.mockReset().mockResolvedValue(undefined);
    invalidate.mockClear();
  });

  afterEach(async () => {
    await testI18n.changeLanguage('en');
  });

  it('records an arbitrary transfer with a friend when nothing is owed', async () => {
    const { user } = renderDrawer(friendContext());
    const save = await open(user);

    expect(screen.getByText(/Nothing is owed between them/)).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    expect(amount).toHaveValue('');
    expect(save).toBeDisabled();

    await user.type(amount, '10');
    await user.click(save);

    expect(lastPayload()).toEqual(
      expect.objectContaining({
        amount: 1000n,
        currency: 'USD',
        splitType: SplitType.SETTLEMENT,
        paidBy: 1,
        groupId: null,
        participants: [
          { userId: 1, amount: 1000n },
          { userId: 2, amount: -1000n },
        ],
      }),
    );
  });

  it('swaps the direction', async () => {
    const { user } = renderDrawer(friendContext());
    const save = await open(user);
    await user.click(screen.getByRole('button', { name: 'Swap direction' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '5');
    await user.click(save);
    expect(lastPayload()).toEqual(expect.objectContaining({ amount: 500n, paidBy: 2 }));
  });

  it('follows the open balance by default and fills the amount from a suggestion', async () => {
    const { user } = renderDrawer(
      friendContext([
        { currency: 'USD', amount: -1250n, friendId: 2, groupId: 7, groupName: 'Trip' },
      ]),
    );
    const save = await open(user);

    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Record in' })).toHaveTextContent('Trip');

    await user.click(screen.getByRole('button', { name: /You pay \$12\.5 to Sam Friend/ }));
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('$12.5');
    await user.click(save);

    expect(lastPayload()).toEqual(
      expect.objectContaining({ amount: 1250n, paidBy: 1, groupId: 7, currency: 'USD' }),
    );
  });

  it('records outside any group when chosen', async () => {
    const { user } = renderDrawer(
      friendContext([
        { currency: 'USD', amount: -1250n, friendId: 2, groupId: 7, groupName: 'Trip' },
      ]),
    );
    const save = await open(user);
    await pick(user, 'Record in', 'No group');
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '3');
    await user.click(save);
    expect(lastPayload()).toEqual(expect.objectContaining({ amount: 300n, groupId: null }));
  });

  it('shows what will be owed after paying more than the open balance', async () => {
    const { user } = renderDrawer(
      friendContext([{ currency: 'USD', amount: -1000n, friendId: 2, groupId: null }]),
    );
    await open(user);
    await user.click(screen.getByRole('button', { name: /You pay \$10 to Sam Friend/ }));
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    await user.clear(amount);
    await user.type(amount, '12');
    const hint = screen.getByText(/after this/);
    expect(hint).toHaveTextContent('Sam Friend will owe you $2 after this');
    expect(within(hint).getByText('$2')).toHaveClass('text-positive');
  });

  it('shows the overpay hint when typing above the matching balance without tapping it', async () => {
    const { user } = renderDrawer(
      friendContext([{ currency: 'USD', amount: -1000n, friendId: 2, groupId: null }]),
    );
    await open(user);
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '12');
    const hint = screen.getByText(/after this/);
    expect(hint).toHaveTextContent('Sam Friend will owe you $2 after this');
    expect(within(hint).getByText('$2')).toHaveClass('text-positive');
  });

  it('shows no overpay hint when the draft goes against the open balance', async () => {
    const { user } = renderDrawer(
      friendContext([{ currency: 'USD', amount: -1000n, friendId: 2, groupId: null }]),
    );
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Swap direction' }));
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '12');
    expect(screen.queryByText(/after this/)).toBeNull();
  });

  it('falls back to settle mode when changing "Record in" clears the selected balance', async () => {
    const { user } = renderDrawer(friendContext([balance(-1000n, 'EUR', 7, 'Trip')]));
    const save = await open(user);
    await user.click(screen.getByRole('button', { name: /Trip/ }));
    await user.click(screen.getByRole('tab', { name: 'Convert' }));
    await pick(user, 'Record in', 'No group');

    expect(screen.getByRole('tab', { name: 'Settle' })).toHaveAttribute('aria-selected', 'true');
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    expect(amount).toBeVisible();
    expect(amount).not.toHaveValue('');
    expect(save).toBeEnabled();
  });

  it('keeps the amount value when the currency changes', async () => {
    const { user } = renderDrawer(friendContext([balance(-123456n, 'USD', 7, 'Trip')]));
    const save = await open(user);
    await user.click(screen.getByRole('button', { name: /You pay .* to Sam Friend/ }));
    await pickJpy(user);
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('¥1,235');
    await user.click(save);
    expect(lastPayload()).toEqual(expect.objectContaining({ amount: 1235n, currency: 'JPY' }));
  });

  it('keeps the amount value when the currency changes in a locale with swapped separators', async () => {
    await testI18n.changeLanguage('de');
    const { user } = renderDrawer(friendContext([balance(-123456n, 'EUR', 7, 'Trip')]));
    const save = await open(user);
    await user.click(screen.getByRole('button', { name: /You pay .* to Sam Friend/ }));
    await pickJpy(user);
    await user.click(save);
    expect(lastPayload()).toEqual(expect.objectContaining({ amount: 1235n, currency: 'JPY' }));
  });

  it('keeps an empty amount empty when the currency changes', async () => {
    const { user } = renderDrawer(friendContext());
    await open(user);
    await pickJpy(user);
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('');
  });

  it('resets the conversion when another suggestion with the same amount is picked', async () => {
    const { user } = renderDrawer(
      friendContext([balance(-10000n, 'EUR', 7, 'Trip'), balance(-10000n, 'EUR', 8, 'Home')]),
    );
    const save = await open(user);
    await user.click(screen.getByRole('button', { name: /Trip/ }));
    await user.click(screen.getByRole('tab', { name: 'Convert' }));
    const source = screen.getByRole('textbox', { name: 'Amount' });
    await user.clear(source);
    await user.type(source, '25');
    await user.click(screen.getByRole('button', { name: /Home/ }));
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() =>
      expect(mutateConversion).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 10000n, from: 'EUR', groupId: 8 }),
      ),
    );
  });

  it('starts the conversion form afresh when the same balance row is reopened', async () => {
    const initial: SettleUpInitial = {
      payerId: 2,
      receiverId: 3,
      currency: 'EUR',
      amount: 10000n,
      mode: 'convert',
    };
    const context = groupContext(both(3, 2, 10000n, 'EUR'));
    const Wrapper: React.FC = () => {
      const [isOpen, setIsOpen] = React.useState(false);
      return (
        <SettleUpDrawer
          open={isOpen}
          onOpenChange={setIsOpen}
          initial={initial}
          context={context}
          trigger={<button>Open settle up</button>}
        />
      );
    };
    const user = userEvent.setup();
    renderWithProviders(<Wrapper />);

    await open(user);
    const source = screen.getByRole('textbox', { name: 'Amount' });
    await user.clear(source);
    await user.type(source, '25');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());

    const save = await open(user);
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() =>
      expect(mutateConversion).toHaveBeenCalledWith(expect.objectContaining({ amount: 10000n })),
    );
  });

  it('lets a group settlement pick both people and suggests their balance', async () => {
    const { user } = renderDrawer(groupContext(both(3, 2, 500n)));
    const save = await open(user);

    // The current user has no open balances, so there is no default counterparty.
    expect(save).toBeDisabled();

    await pick(user, 'From', 'Sam Friend');
    await pick(user, 'To', 'Kim Third');
    await user.click(screen.getByRole('button', { name: /Sam Friend pays \$5 to Kim Third/ }));
    await user.click(save);

    expect(lastPayload()).toEqual(
      expect.objectContaining({
        amount: 500n,
        paidBy: 2,
        groupId: 9,
        participants: [
          { userId: 2, amount: 500n },
          { userId: 3, amount: -500n },
        ],
      }),
    );
  });

  it('defaults a group settlement to the largest balance involving the current user', async () => {
    const { user } = renderDrawer(groupContext([...both(1, 2, 200n), ...both(1, 3, -900n)]));
    await open(user);
    // The current user is shown as "You", not by name.
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveTextContent(/^You$/);
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveTextContent('Kim Third');
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('');
  });

  it('opens a balance row prefilled in convert mode and saves a conversion', async () => {
    const { user } = renderDrawer(groupContext(both(3, 2, 1000n, 'EUR')), {
      payerId: 2,
      receiverId: 3,
      currency: 'EUR',
      amount: 1000n,
      mode: 'convert',
    });
    const save = await open(user);

    expect(screen.getByRole('tab', { name: 'Convert' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() =>
      expect(mutateConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000n,
          from: 'EUR',
          to: 'USD',
          rate: 2,
          senderId: 2,
          receiverId: 3,
          groupId: 9,
        }),
      ),
    );
    expect(mutateExpense).not.toHaveBeenCalled();
  });

  it('enables saving a conversion after picking a suggestion with a grouped amount', async () => {
    const { user } = renderDrawer(groupContext(both(3, 2, 123456n, 'EUR')));
    const save = await open(user);

    await pick(user, 'From', 'Sam Friend');
    await pick(user, 'To', 'Kim Third');
    await user.click(screen.getByRole('button', { name: /Sam Friend pays .* to Kim Third/ }));
    await user.click(screen.getByRole('tab', { name: 'Convert' }));
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() =>
      expect(mutateConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 123456n,
          from: 'EUR',
          rate: 2,
          senderId: 2,
          receiverId: 3,
          groupId: 9,
        }),
      ),
    );
  });

  it('keeps convert disabled until an open balance is picked', async () => {
    const { user } = renderDrawer(friendContext());
    await open(user);
    expect(screen.getByRole('tab', { name: 'Convert' })).toBeDisabled();
  });

  it('edits an existing settlement in place', async () => {
    const expenseDate = new Date('2026-03-04');
    const { user } = renderDrawer({
      kind: 'edit',
      expense: {
        id: 'exp-1',
        amount: 700n,
        currency: 'USD',
        groupId: null,
        expenseDate,
        paidBy: 2,
        paidByUser: friend,
        expenseParticipants: [
          { userId: 2, user: friend },
          { userId: 1, user: me },
        ],
        group: null,
      },
    });
    const save = await open(user);

    expect(screen.queryByRole('tab', { name: 'Convert' })).not.toBeInTheDocument();
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    expect(amount).toHaveValue('$7');
    await user.clear(amount);
    await user.type(amount, '8');
    await user.click(save);

    expect(lastPayload()).toEqual(
      expect.objectContaining({ expenseId: 'exp-1', expenseDate, amount: 800n, paidBy: 2 }),
    );
  });

  it('colours suggestion amounts by direction relative to the current user', async () => {
    const mine = renderDrawer(friendContext([balance(-1250n, 'USD', 7, 'Trip')]));
    await open(mine.user);
    const pay = screen.getByRole('button', { name: /You pay \$12\.5 to Sam Friend/ });
    expect(within(pay).getByText('$12.5')).toHaveClass('text-negative');
    mine.view.unmount();

    const owed = renderDrawer(friendContext([balance(1250n, 'USD', 7, 'Trip')]));
    await open(owed.user);
    const paid = screen.getByRole('button', { name: /Sam Friend pays \$12\.5 to you/ });
    expect(within(paid).getByText('$12.5')).toHaveClass('text-positive');
    owed.view.unmount();

    const group = renderDrawer(groupContext(both(3, 2, 500n)));
    await open(group.user);
    await pick(group.user, 'From', 'Sam Friend');
    await pick(group.user, 'To', 'Kim Third');
    const thirdParty = screen.getByRole('button', { name: /Sam Friend pays \$5 to Kim Third/ });
    const thirdAmount = within(thirdParty).getByText('$5');
    expect(thirdAmount).not.toHaveClass('text-positive');
    expect(thirdAmount).not.toHaveClass('text-negative');
  });

  it('shows the visible direction of each suggestion as a translated sentence', async () => {
    const mine = renderDrawer(friendContext([balance(-1250n, 'USD', 7, 'Trip')]));
    await open(mine.user);
    const pay = screen.getByRole('button', { name: /You pay \$12\.5 to Sam Friend/ });
    expect(within(pay).getByText('You pay Sam Friend')).toBeInTheDocument();
    mine.view.unmount();

    const owed = renderDrawer(friendContext([balance(1250n, 'USD', 7, 'Trip')]));
    await open(owed.user);
    const paid = screen.getByRole('button', { name: /Sam Friend pays \$12\.5 to you/ });
    expect(within(paid).getByText('Sam Friend pays you')).toBeInTheDocument();
    owed.view.unmount();

    const group = renderDrawer(groupContext(both(3, 2, 500n)));
    await open(group.user);
    await pick(group.user, 'From', 'Sam Friend');
    await pick(group.user, 'To', 'Kim Third');
    const thirdParty = screen.getByRole('button', { name: /Sam Friend pays \$5 to Kim Third/ });
    expect(within(thirdParty).getByText('Sam Friend pays Kim Third')).toBeInTheDocument();
    // An unformatted ICU message would leak its select syntax into the drawer.
    expect(screen.queryByText(/select,/)).not.toBeInTheDocument();
  });

  describe('saving', () => {
    const quiet = () => jest.spyOn(console, 'error').mockImplementation(() => undefined);

    it('keeps the drawer open and the draft when saving a settlement fails', async () => {
      const spy = quiet();
      mutateExpense.mockRejectedValue(new Error('boom'));
      const { user } = renderDrawer(friendContext());
      const save = await open(user);
      await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10');
      await user.click(save);

      await waitFor(() => expect(mutateExpense).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(save).toBeEnabled());
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue('$10');
      expect(invalidate).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('closes the drawer after a successful settlement save', async () => {
      const { user } = renderDrawer(friendContext());
      const save = await open(user);
      await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10');
      await user.click(save);

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
      expect(invalidate).toHaveBeenCalled();
    });

    it('keeps the drawer open in convert mode when saving a conversion fails', async () => {
      const spy = quiet();
      mutateConversion.mockRejectedValue(new Error('boom'));
      const { user } = renderDrawer(groupContext(both(3, 2, 1000n, 'EUR')), {
        payerId: 2,
        receiverId: 3,
        currency: 'EUR',
        amount: 1000n,
        mode: 'convert',
      });
      const save = await open(user);
      await waitFor(() => expect(save).toBeEnabled());
      await user.click(save);

      await waitFor(() => expect(mutateConversion).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Convert' })).toHaveAttribute('aria-selected', 'true');
      expect(invalidate).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('disables Save while the mutation is pending and ignores a second click', async () => {
      mutateExpense.mockReturnValue(new Promise(() => undefined));
      const { user } = renderDrawer(friendContext());
      const save = await open(user);
      await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10');
      await user.click(save);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
      await user.click(save);

      expect(mutateExpense).toHaveBeenCalledTimes(1);
    });

    it('closes the drawer when Back is pressed and nothing is saving', async () => {
      const { user } = renderDrawer(friendContext());
      await open(user);
      await user.click(screen.getByRole('button', { name: 'Back' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('keeps the drawer open on Back and Escape while saving, then closes when the save succeeds', async () => {
      let resolveSave: () => void = () => undefined;
      mutateExpense.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
      );
      const { user } = renderDrawer(friendContext());
      const save = await open(user);
      await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10');
      await user.click(save);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());

      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      resolveSave();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(invalidate).toHaveBeenCalled();
    });
  });
});
