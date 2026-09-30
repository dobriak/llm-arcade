import { test, expect } from '../../lib/fixtures.js';
import { uniq } from '../../lib/api.js';
import { autoAcceptDialogs, byId, card, column, confirmIfNeeded, openBoard, selectFlexible, visibleCards } from '../../lib/ui.js';

test.describe('home page', { tag: '@ui' }, () => {
  test('lists boards with the required test hooks', async ({ page, api }) => {
    const b = await api.createBoard(uniq('Listed'), 'shown on home');
    await page.goto('/');
    await expect(page).toHaveTitle('Kanban');
    await expect(byId(page, 'board-list')).toBeVisible();
    const item = page.locator(`[data-testid="board-item"][data-board-id="${b.id}"]`);
    await expect(item).toContainText(b.name);
    await item.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/boards/${b.id}(\\b|/|\\?|$)`));
    await expect(byId(page, 'board-title')).toContainText(b.name);
  });

  test('create a board from the form', async ({ page, api }) => {
    const name = uniq('UI board');
    await page.goto('/');
    await byId(page, 'new-board-name').fill(name);
    await byId(page, 'new-board-description').fill('made in the browser');
    await byId(page, 'new-board-submit').click();
    // Either the app navigates to the new board, or the board appears in the list.
    await expect.poll(async () => (await api.boards()).some((b) => b.name === name)).toBe(true);
    const created = (await api.boards()).find((b) => b.name === name)!;
    expect(created.description).toBe('made in the browser');
    const onBoardPage = await page.waitForURL(/\/boards\/\d+/, { timeout: 3000 }).then(() => true, () => false);
    if (!onBoardPage) {
      await page.locator(`[data-testid="board-item"][data-board-id="${created.id}"]`).getByRole('link').first().click();
    }
    await expect(byId(page, 'board-title')).toContainText(name);
    await expect(page).toHaveTitle(`${name} · Kanban`);
    await expect(page.getByTestId('column')).toHaveCount(3);
    await expect(page.getByTestId('column-name')).toHaveText([/To Do/, /In Progress/, /Done/]);
  });

  test('delete a board', async ({ page, api }) => {
    autoAcceptDialogs(page);
    const b = await api.createBoard(uniq('Delete me'));
    await openBoard(page, b.id);
    // Prefer an explicit "delete board" control on the board page; otherwise use the one on the board's list entry.
    let button = page.getByRole('button', { name: /delete board/i }).filter({ visible: true });
    if ((await button.count()) === 0) {
      await page.goto('/');
      button = page.locator(`[data-testid="board-item"][data-board-id="${b.id}"]`).getByRole('button', { name: /delete/i });
    }
    await button.first().click();
    await confirmIfNeeded(page);
    await expect.poll(async () => (await api.raw.get(`/api/boards/${b.id}`)).status()).toBe(404);
  });

  test('unknown board shows a not-found page', async ({ page }) => {
    await page.goto('/boards/987654321');
    await expect(page.locator('body')).toContainText(/not found|404/i);
  });
});

test.describe('board page', { tag: '@ui' }, () => {
  test('add a card with Enter; it persists after reload', async ({ page, api }) => {
    const b = await api.createBoard();
    await openBoard(page, b.id);
    const todo = column(page, b.columns[0].id);
    const input = todo.getByTestId('add-card-input');
    await input.fill('Typed card');
    await input.press('Enter');
    await expect(todo.getByTestId('card-title')).toHaveText(['Typed card']);
    await expect(todo.getByTestId('column-count')).toHaveText(/^\s*1\s*$/);
    await page.reload();
    await expect(column(page, b.columns[0].id).getByTestId('card-title')).toHaveText(['Typed card']);
    expect((await api.board(b.id)).columns[0].cards.map((c) => c.title)).toEqual(['Typed card']);
  });

  test('add a column', async ({ page, api }) => {
    const b = await api.createBoard();
    await openBoard(page, b.id);
    await byId(page, 'add-column-name').fill('QA');
    await byId(page, 'add-column-submit').click();
    await expect(page.getByTestId('column')).toHaveCount(4);
    await expect(page.getByTestId('column-name').last()).toHaveText(/QA/);
    await expect.poll(async () => (await api.board(b.id)).columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done', 'QA']);
  });

  test('column count shows "n / limit" when a WIP limit is set', async ({ page, api }) => {
    const { board, cols } = await api.seedBoard([0, 2, 1]);
    await api.patchColumn(cols[1].id, { wip_limit: 3 });
    await openBoard(page, board.id);
    await expect(column(page, cols[1].id).getByTestId('column-count')).toHaveText(/^\s*2\s*\/\s*3\s*$/);
    await expect(column(page, cols[2].id).getByTestId('column-count')).toHaveText(/^\s*1\s*$/);
  });

  test('edit a card in the detail view', async ({ page, api }) => {
    const { board, cards } = await api.seedBoard([1, 0, 0]);
    const id = cards[0][0].id;
    await openBoard(page, board.id);
    await card(page, id).click();
    const detail = byId(page, 'card-detail');
    await expect(detail).toBeVisible();
    await byId(page, 'card-detail-title').fill('Edited title');
    await byId(page, 'card-detail-description').fill('Edited description');
    await selectFlexible(byId(page, 'card-detail-priority'), 'high', /high/i);
    await byId(page, 'card-detail-due-date').fill('2031-02-03');
    await byId(page, 'card-detail-save').click();
    await expect.poll(async () => api.card(id)).toMatchObject({
      title: 'Edited title', description: 'Edited description', priority: 'high', due_date: '2031-02-03',
    });
    await page.reload();
    await expect(card(page, id).getByTestId('card-title')).toHaveText('Edited title');
  });

  test('card detail closes with Escape', async ({ page, api }) => {
    const { board, cards } = await api.seedBoard([1, 0, 0]);
    await openBoard(page, board.id);
    await card(page, cards[0][0].id).click();
    await expect(byId(page, 'card-detail')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(byId(page, 'card-detail')).toBeHidden();
  });

  test('move a card without drag-and-drop via the column select', async ({ page, api }) => {
    const { board, cols, cards } = await api.seedBoard([1, 0, 1]);
    const id = cards[0][0].id;
    await openBoard(page, board.id);
    await card(page, id).click();
    await expect(byId(page, 'card-detail')).toBeVisible();
    await selectFlexible(byId(page, 'card-detail-column'), String(cols[2].id), /^Done$/);
    // Some UIs move on change, others on save.
    const moved = async () => (await api.card(id)).column_id === cols[2].id;
    await page.waitForTimeout(1000);
    if (!(await moved())) {
      const save = byId(page, 'card-detail-save');
      if (await save.isVisible()) await save.click();
    }
    await expect.poll(moved).toBe(true);
    const done = (await api.board(board.id)).columns[2].cards.map((c) => c.id);
    expect(done, 'moved card is appended to the end').toEqual([cards[2][0].id, id]);
    await page.reload();
    await expect(column(page, cols[2].id).locator(`[data-card-id="${id}"]`)).toBeVisible();
  });

  test('delete a card from the detail view', async ({ page, api }) => {
    autoAcceptDialogs(page);
    const { board, cards } = await api.seedBoard([2, 0, 0]);
    const id = cards[0][0].id;
    await openBoard(page, board.id);
    await card(page, id).click();
    await byId(page, 'card-detail-delete').click();
    await confirmIfNeeded(page);
    await expect.poll(async () => (await api.raw.get(`/api/cards/${id}`)).status()).toBe(404);
    await expect(card(page, id)).toHaveCount(0);
    await expect(visibleCards(page)).toHaveCount(1);
  });

  test('label management shows the board labels', async ({ page, api }) => {
    const b = await api.createBoard();
    await api.createLabel(b.id, 'backend', '#112233');
    await api.createLabel(b.id, 'frontend', '#445566');
    await openBoard(page, b.id);
    await byId(page, 'labels-open').click();
    await expect(page.getByText('backend', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('frontend', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  });

  test('card tiles show labels', async ({ page, api }) => {
    const b = await api.createBoard();
    const l = await api.createLabel(b.id, 'tile-label', '#aa0000');
    const c = await api.createCard(b.columns[0].id, { title: 'Has label', label_ids: [l.id], priority: 'urgent' });
    await openBoard(page, b.id);
    await expect(card(page, c.id)).toContainText('tile-label');
  });

  test('usable at 375px width', async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const b = await api.createBoard();
    await openBoard(page, b.id);
    const input = column(page, b.columns[0].id).getByTestId('add-card-input');
    await input.scrollIntoViewIfNeeded();
    await input.fill('Mobile card');
    await input.press('Enter');
    await expect.poll(async () => (await api.board(b.id)).columns[0].cards.length).toBe(1);
  });
});
