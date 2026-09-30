import { test, expect } from '../../lib/fixtures.js';
import { byId, card, column, columnDropTarget, drag, openBoard, selectFlexible, visibleCards } from '../../lib/ui.js';

test.describe('drag and drop', { tag: '@ui' }, () => {
  test('drag a card to another column', async ({ page, api }) => {
    const { board, cols, cards } = await api.seedBoard([2, 1, 0]);
    const id = cards[0][0].id;
    await openBoard(page, board.id);
    const { target, where } = await columnDropTarget(page, cols[1].id);
    await drag(page, card(page, id), target, where);
    await expect.poll(async () => (await api.card(id)).column_id, { timeout: 8000 }).toBe(cols[1].id);
    const layout = await api.layout(board.id);
    expect(layout[0].cardIds).toEqual([cards[0][1].id]);
    expect(layout[1].cardIds).toContain(id);
    await page.reload();
    await expect(column(page, cols[1].id).locator(`[data-card-id="${id}"]`)).toBeVisible();
  });

  test('drag a card into an empty column', async ({ page, api }) => {
    const { board, cols, cards } = await api.seedBoard([1, 0, 0]);
    const id = cards[0][0].id;
    await openBoard(page, board.id);
    const { target, where } = await columnDropTarget(page, cols[2].id);
    await drag(page, card(page, id), target, where);
    await expect.poll(async () => (await api.card(id)).column_id, { timeout: 8000 }).toBe(cols[2].id);
  });

  test('drag to reorder within a column', async ({ page, api }) => {
    const { board, cols, cards } = await api.seedBoard([3, 0, 0]);
    const [a, , c] = cards[0].map((x) => x.id);
    await openBoard(page, board.id);
    await drag(page, card(page, c), card(page, a), 'top');
    await expect.poll(async () => (await api.card(c)).position, { timeout: 8000 }).toBe(0);
    const layout = await api.layout(board.id);
    expect(layout[0].cardIds).toHaveLength(3);
    expect(layout[0].cardIds[0]).toBe(c);
    expect((await api.board(board.id)).columns[0].cards.map((k) => k.position)).toEqual([0, 1, 2]);
    await page.reload();
    await expect(column(page, cols[0].id).getByTestId('card').first()).toHaveAttribute('data-card-id', String(c));
  });

  test('dropping into a full column shows an error and the card stays put', async ({ page, api }) => {
    const { board, cols, cards } = await api.seedBoard([2, 1, 0]);
    await api.patchColumn(cols[1].id, { wip_limit: 1 });
    const id = cards[0][0].id;
    await openBoard(page, board.id);
    const { target, where } = await columnDropTarget(page, cols[1].id);
    await drag(page, card(page, id), target, where);
    await expect(byId(page, 'toast')).toBeVisible();
    expect((await api.card(id)).column_id).toBe(cols[0].id);
    // The UI must not keep showing the card in the full column.
    await expect(column(page, cols[0].id).locator(`[data-card-id="${id}"]`)).toBeVisible();
    await expect(column(page, cols[1].id).locator(`[data-card-id="${id}"]`)).toHaveCount(0);
  });
});

test.describe('filters', { tag: '@ui' }, () => {
  async function fixture(api: import('../../lib/api.js').Api) {
    const b = await api.createBoard();
    const [todo, doing] = b.columns;
    const bug = await api.createLabel(b.id, 'bugfix', '#d73a4a');
    const ids = {
      alpha: (await api.createCard(todo.id, { title: 'Alpha login fix', priority: 'high', label_ids: [bug.id] })).id,
      beta: (await api.createCard(todo.id, { title: 'Beta docs', priority: 'low' })).id,
      gamma: (await api.createCard(doing.id, { title: 'Gamma', description: 'related to ALPHA', priority: 'high' })).id,
      delta: (await api.createCard(doing.id, { title: 'Delta', priority: 'urgent', label_ids: [bug.id] })).id,
    };
    return { b, bug, ids };
  }
  const shownIds = async (page: import('@playwright/test').Page) =>
    (await visibleCards(page).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-card-id'))))).sort((x, y) => x - y);

  test('text filter narrows cards, is reflected in the URL and survives reload', async ({ page, api }) => {
    const { b, ids } = await fixture(api);
    await openBoard(page, b.id);
    await expect(visibleCards(page)).toHaveCount(4);
    await byId(page, 'filter-q').fill('alpha');
    await expect.poll(() => shownIds(page)).toEqual([ids.alpha, ids.gamma].sort((x, y) => x - y));
    await expect(page).toHaveURL(/[?&]q=alpha/);
    // Counts stay unfiltered (FLT-3).
    await expect(column(page, b.columns[0].id).getByTestId('column-count')).toHaveText(/^\s*2\s*$/);
    await page.reload();
    await expect(byId(page, 'filter-q')).toHaveValue('alpha');
    await expect.poll(() => shownIds(page)).toEqual([ids.alpha, ids.gamma].sort((x, y) => x - y));
  });

  test('priority and label filters combine', async ({ page, api }) => {
    const { b, bug, ids } = await fixture(api);
    await openBoard(page, b.id);
    await selectFlexible(byId(page, 'filter-priority'), 'high', /^high$/i);
    await expect.poll(() => shownIds(page)).toEqual([ids.alpha, ids.gamma].sort((x, y) => x - y));
    await selectFlexible(byId(page, 'filter-label'), String(bug.id), 'bugfix');
    await expect.poll(() => shownIds(page)).toEqual([ids.alpha]);
    await expect(page).toHaveURL(/priority=high/);
  });
});
