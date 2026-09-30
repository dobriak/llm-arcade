import { test, expect } from '../../lib/fixtures.js';
import { expectColumn, expectContiguous, expectError, expectValidationError } from '../../lib/api.js';

test.describe('columns', { tag: '@api' }, () => {
  test('POST /api/boards/{id}/columns appends a column', async ({ api }) => {
    const b = await api.createBoard();
    const res = await api.raw.post(`/api/boards/${b.id}/columns`, { name: '  Review  ' });
    expect(res.status()).toBe(201);
    const col = await res.json();
    expectColumn(col);
    expect(col).toMatchObject({ board_id: b.id, name: 'Review', position: 3, wip_limit: null, card_count: 0 });
    const withLimit = await api.createColumn(b.id, 'Limited', 4);
    expect(withLimit).toMatchObject({ position: 4, wip_limit: 4 });
    const detail = await api.board(b.id);
    expect(detail.columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done', 'Review', 'Limited']);
    expectContiguous(detail.columns, 'board columns');
  });

  for (const [label, body, field] of [
    ['missing name', {}, 'name'],
    ['empty name', { name: '' }, 'name'],
    ['name longer than 50', { name: 'c'.repeat(51) }, 'name'],
    ['wip_limit 0', { name: 'ok', wip_limit: 0 }, 'wip_limit'],
    ['wip_limit 1000', { name: 'ok', wip_limit: 1000 }, 'wip_limit'],
    ['negative wip_limit', { name: 'ok', wip_limit: -1 }, 'wip_limit'],
  ] as const) {
    test(`POST column rejects ${label} with 422`, async ({ api }) => {
      const b = await api.createBoard();
      await expectValidationError(await api.raw.post(`/api/boards/${b.id}/columns`, body), field);
    });
  }

  test('POST column rejects a non-numeric wip_limit', async ({ api }) => {
    const b = await api.createBoard();
    await expectError(await api.raw.post(`/api/boards/${b.id}/columns`, { name: 'x', wip_limit: 'many' }), [400, 422]);
  });

  test('POST column on an unknown board returns 404', async ({ api }) => {
    await expectError(await api.raw.post('/api/boards/987654321/columns', { name: 'x' }), 404, 'not_found');
  });

  test('PATCH /api/columns/{id}: rename, set, keep and clear wip_limit', async ({ api }) => {
    const b = await api.createBoard();
    const id = b.columns[1].id;
    let c = await api.patchColumn(id, { name: 'Doing' });
    expectColumn(c);
    expect(c).toMatchObject({ name: 'Doing', wip_limit: null, position: 1 });
    c = await api.patchColumn(id, { wip_limit: 5 });
    expect(c).toMatchObject({ name: 'Doing', wip_limit: 5 });
    c = await api.patchColumn(id, { name: 'Doing now' });
    expect(c.wip_limit, 'absent wip_limit must stay unchanged').toBe(5);
    c = await api.patchColumn(id, { wip_limit: null });
    expect(c.wip_limit, 'explicit null must clear wip_limit').toBeNull();
  });

  test('PATCH column validates and 404s', async ({ api }) => {
    const b = await api.createBoard();
    await expectValidationError(await api.raw.patch(`/api/columns/${b.columns[0].id}`, { name: '' }), 'name');
    await expectValidationError(await api.raw.patch(`/api/columns/${b.columns[0].id}`, { wip_limit: 0 }), 'wip_limit');
    await expectError(await api.raw.patch('/api/columns/987654321', { name: 'x' }), 404, 'not_found');
  });

  test('card_count reflects the cards in a column', async ({ api }) => {
    const { board, cols } = await api.seedBoard([2, 1, 0]);
    const detail = await api.board(board.id);
    expect(detail.columns.map((c) => c.card_count)).toEqual([2, 1, 0]);
    const patched = await api.patchColumn(cols[0].id, { name: 'Still two' });
    expect(patched.card_count).toBe(2);
  });

  test('DELETE /api/columns/{id} deletes its cards and re-packs remaining columns', async ({ api }) => {
    const { board, cols, cards } = await api.seedBoard([0, 2, 1]);
    const res = await api.raw.delete(`/api/columns/${cols[1].id}`);
    expect(res.status()).toBe(204);
    const detail = await api.board(board.id);
    expect(detail.columns.map((c) => c.id)).toEqual([cols[0].id, cols[2].id]);
    expectContiguous(detail.columns, 'columns after delete');
    for (const card of cards[1]) await expectError(await api.raw.get(`/api/cards/${card.id}`), 404, 'not_found');
    expect((await api.card(cards[2][0].id)).column_id).toBe(cols[2].id);
    await expectError(await api.raw.delete(`/api/columns/${cols[1].id}`), 404, 'not_found');
  });
});
