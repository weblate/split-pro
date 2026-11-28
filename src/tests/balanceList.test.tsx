/**
 * @jest-environment jsdom
 */
import type { BalanceView } from '@prisma/client';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { renderWithProviders } from '~/tests/helpers/render';
import { createTestUser } from '~/tests/helpers/user';

jest.mock('~/utils/api', () => ({
  api: {
    user: { me: { useQuery: () => ({ data: { id: 1 } }) } },
  },
}));

import { BalanceList } from '~/components/Expense/BalanceList';

const me = createTestUser({ id: 1, name: 'Alex Example' });
const friend = createTestUser({ id: 2, name: 'Sam Friend', email: 'sam@example.test' });

const view = (userId: number, friendId: number, amount: bigint): BalanceView =>
  ({ userId, friendId, amount, currency: 'USD', groupId: 9 }) as BalanceView;

describe('BalanceList', () => {
  it('colours the amount in an expanded row by who owes whom', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BalanceList users={[me, friend]} groupBalances={[view(1, 2, 500n), view(2, 1, -500n)]} />,
    );

    await user.click(screen.getByRole('button', { name: /Alex Example|You lent/ }));
    await user.click(screen.getByRole('button', { name: /Sam Friend owes/ }));

    const owedToMe = screen.getByText(/Sam Friend pays/);
    expect(owedToMe).toHaveTextContent('Sam Friend pays $5 to you');
    expect(within(owedToMe).getByText('$5')).toHaveClass('text-emerald-500');

    const iOwe = screen.getByText(/You get/);
    expect(iOwe).toHaveTextContent('You get $5 from Sam Friend');
    expect(within(iOwe).getByText('$5')).toHaveClass('text-orange-600');
  });
});
