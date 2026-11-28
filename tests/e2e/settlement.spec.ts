import { SplitType } from '@prisma/client';
import { createDatabaseUser } from '~/tests/helpers/databaseFactories';
import { createDatabaseExpense, expect, expenseInput, test } from './fixtures';

test('partially then fully settles a real debt through the UI', async ({ page, scenario, db }) => {
  await createDatabaseExpense(
    db,
    expenseInput(scenario.member.id, scenario.owner.id, { groupId: scenario.group.id }),
  );
  await page.goto(`/en/balances/${scenario.member.id}`);
  const settle = async (amount: string) => {
    await page.getByRole('button', { name: 'Settle up', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill(amount);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  };
  await settle('4.00');
  await expect
    .poll(
      async () =>
        (
          await db.balanceView.findFirst({
            where: {
              userId: scenario.owner.id,
              groupId: scenario.group.id,
            },
          })
        )?.amount,
    )
    .toBe(-600n);
  await page.reload();
  await expect(page.getByText('$6', { exact: true })).toBeVisible();
  await settle('6.00');
  await expect
    .poll(async () =>
      (
        await db.balanceView.findMany({
          where: {
            groupId: scenario.group.id,
          },
        })
      ).every((balance) => 0n === balance.amount),
    )
    .toBe(true);
  await page.reload();
  // Settling stays available with nothing owed, so a new loan or repayment can still be recorded.
  await page.getByRole('button', { name: 'Settle up', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(/Nothing is owed between them/)).toBeVisible();
  const settlements = await db.expense.findMany({
    where: { groupId: scenario.group.id, splitType: SplitType.SETTLEMENT },
    orderBy: { createdAt: 'asc' },
  });
  expect(settlements.map((expense) => expense.amount)).toEqual([400n, 600n]);
  expect(settlements.every((expense) => expense.paidBy === scenario.owner.id)).toBe(true);
});

test('records a transfer in either direction without an existing debt', async ({
  page,
  scenario,
  db,
}) => {
  // A friend page only exists for people you share a balance with, so give the pair past
  // Expenses that cancel out: they are friends, but nothing is owed.
  await createDatabaseExpense(db, expenseInput(scenario.owner.id, scenario.member.id));
  await createDatabaseExpense(db, expenseInput(scenario.member.id, scenario.owner.id));
  await page.goto(`/en/balances/${scenario.member.id}`);
  const record = async (amount: string, direction: string) => {
    await page.getByRole('button', { name: 'Settle up', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The same sentence also labels the open-balance suggestion, so check the summary itself.
    await expect(dialog.getByTestId('settle-up-direction')).toHaveText(direction);
    await dialog.getByRole('textbox', { name: 'Amount' }).fill(amount);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  };
  const ownerBalance = async () =>
    (
      await db.balanceView.findFirst({
        where: { userId: scenario.owner.id, friendId: scenario.member.id, groupId: null },
      })
    )?.amount;

  // The owner lends 10, then the member repays 4.
  await record('10.00', 'You pay E2E Member');
  await expect.poll(ownerBalance).toBe(1000n);
  // Reload so the drawer opens from fresh balances, where it defaults to the member paying back.
  await page.reload();
  await record('4.00', 'E2E Member pays you');
  await expect.poll(ownerBalance).toBe(600n);

  const settlements = await db.expense.findMany({
    where: {
      splitType: SplitType.SETTLEMENT,
      groupId: null,
      paidBy: { in: [scenario.owner.id, scenario.member.id] },
    },
    orderBy: { createdAt: 'asc' },
  });
  expect(settlements.map(({ paidBy, amount }) => [paidBy, amount])).toEqual([
    [scenario.owner.id, 1000n],
    [scenario.member.id, 400n],
  ]);
});

test('settles a balance between two other group members from the group page', async ({
  page,
  scenario,
  db,
}) => {
  // The scenario only cleans up its own two users, so the third one is removed here.
  const third = await createDatabaseUser(db, { name: 'E2E Third' });
  try {
    await db.groupUser.create({ data: { groupId: scenario.group.id, userId: third.id } });
    await createDatabaseExpense(
      db,
      expenseInput(third.id, scenario.member.id, { groupId: scenario.group.id }),
    );

    await page.goto(`/en/groups/${scenario.group.id}`);
    await page.getByRole('button', { name: 'Settle up', exact: true }).click();
    const dialog = page.getByRole('dialog');
    // The pickers are Radix selects, so their options open in a portal outside the dialog.
    await dialog.getByRole('combobox', { name: 'From' }).click();
    await page.getByRole('option', { name: 'E2E Member' }).click();
    await dialog.getByRole('combobox', { name: 'To' }).click();
    await page.getByRole('option', { name: 'E2E Third' }).click();
    await dialog.getByRole('button', { name: /E2E Member pays .* to E2E Third/ }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();

    await expect
      .poll(async () =>
        (await db.balanceView.findMany({ where: { groupId: scenario.group.id } })).every(
          (balance) => 0n === balance.amount,
        ),
      )
      .toBe(true);
  } finally {
    await db.expense.deleteMany({ where: { paidBy: third.id } });
    await db.user.delete({ where: { id: third.id } });
  }
});
