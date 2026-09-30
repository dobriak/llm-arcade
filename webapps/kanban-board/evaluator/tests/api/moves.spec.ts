import { test, expect } from '../../lib/fixtures.js';
import { expectCard, expectColumn, expectContiguous, expectError, type Api } from '../../lib/api.js';

/** Applies the PRD §6.5 card-move semantics to a local model. */
function applyCardMove(model: Map<number, number[]>, cardId: number, toColumn: number, position: number) {
  const from = [...model.entries()].find(([, ids]) => ids.includes(cardId))![0];
  const src = model.get(from)!.filter((id) => id !== cardId);
  if (from === toColumn) {
    const idx = Math.max(0, Math.min(position, src.length)); // n-1 of the list including the card
    src.splice(idx, 0, cardId);
    model.set(from, src);
  } else {
    const dst = [...model.get(toColumn)!];
    dst.splice(Math.max(0, Math.min(position, dst.length)), 0, cardId);
    model.set(from, src);
    model.set(toColumn, dst);
  }
}

async function expectLayout(api: Api, boardId: number, model: Map<number, number[]>, step: string) {
  const b = await api.board(boardId);
  for (const col of b.columns) {
    expectContiguous(col.cards, `${step}: column ${col.id}`);
    expect(col.cards.map((c) => c.id), `${step}: order of column ${col.id}`).toEqual(model.get(col.id));
    expect(col.card_count, `${step}: card_count of column ${col.id}`).toBe(col.cards.length);
    for (const c of col.cards) expect(c.column_id).toBe(col.id);
  }
}

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test.describe('card moves', { tag: '@moves' }, () => {
  test('reorder within a column (down and up)', async ({ api }) => {
    const { board, cols, cards } = await api.seedBoard([4, 0, 0]);
    const [a, b, c, d] = cards[0].map((x) => x.id);
    const moved = await api.moveCard(a, cols[0].id, 2);
    expectCard(moved);
    expect(moved).toMatchObject({ id: a, column_id: cols[0].id, position: 2 });
    expect((await api.layout(board.id))[0].cardIds).toEqual([b, c, a, d]);
    await api.moveCard(d, cols[0].id, 0);
    expect((await api.layout(board.id))[0].cardIds).toEqual([d, b, c, a]);
  });

  test('move to another column inserts at position and re-packs the source', async ({ api }) => {
    const { board, cols, cards } = await api.seedBoard([3, 2, 0]);
    const [a, b, c] = cards[0].map((x) => x.id);
    const [x, y] = cards[1].map((k) => k.id);
    const moved = await api.moveCard(b, cols[1].id, 1);
    expect(moved).toMatchObject({ id: b, column_id: cols[1].id, position: 1 });
    const layout = await api.layout(board.id);
    expect(layout[0].cardIds).toEqual([a, c]);
    expect(layout[1].cardIds).toEqual([x, b, y]);
    const detail = await api.board(board.id);
    detail.columns.forEach((col) => expectContiguous(col.cards, `column ${col.name}`));
    expect(detail.columns.map((col) => col.card_count)).toEqual([2, 3, 0]);
  });

  test('move into an empty column', async ({ api }) => {
    const { board, cols, cards } = await api.seedBoard([2, 0, 0]);
    const moved = await api.moveCard(cards[0][0].id, cols[2].id, 0);
    expect(moved).toMatchObject({ column_id: cols[2].id, position: 0 });
    expect((await api.layout(board.id))[2].cardIds).toEqual([cards[0][0].id]);
  });

  test('positions are clamped (negative → 0, past the end → last / append)', async ({ api }) => {
    const { board, cols, cards } = await api.seedBoard([3, 2, 0]);
    const [a, b, c] = cards[0].map((x) => x.id);
    const [x, y] = cards[1].map((k) => k.id);
    expect((await api.moveCard(a, cols[0].id, 99)).position).toBe(2);
    expect((await api.layout(board.id))[0].cardIds).toEqual([b, c, a]);
    expect((await api.moveCard(a, cols[0].id, -5)).position).toBe(0);
    expect((await api.layout(board.id))[0].cardIds).toEqual([a, b, c]);
    expect((await api.moveCard(c, cols[1].id, 1000)).position).toBe(2);
    expect((await api.layout(board.id))[1].cardIds).toEqual([x, y, c]);
    expect((await api.moveCard(b, cols[1].id, -1)).position).toBe(0);
    expect((await api.layout(board.id))[1].cardIds).toEqual([b, x, y, c]);
  });

  test('moving to the same place is a 200 no-op', async ({ api }) => {
    const { board, cols, cards } = await api.seedBoard([3, 0, 0]);
    const before = await api.layout(board.id);
    const res = await api.raw.post(`/api/cards/${cards[0][1].id}/move`, { column_id: cols[0].id, position: 1 });
    expect(res.status()).toBe(200);
    expect(await api.layout(board.id)).toEqual(before);
  });

  test('moving to a column on another board is 422; unknown card/column is 404', async ({ api }) => {
    const { cols, cards } = await api.seedBoard([1, 0, 0]);
    const other = await api.createBoard();
    await expectError(await api.raw.post(`/api/cards/${cards[0][0].id}/move`, { column_id: other.columns[0].id, position: 0 }), 422, 'validation_error');
    await expectError(await api.raw.post(`/api/cards/${cards[0][0].id}/move`, { column_id: 987654321, position: 0 }), 404, 'not_found');
    await expectError(await api.raw.post(`/api/cards/987654321/move`, { column_id: cols[0].id, position: 0 }), 404, 'not_found');
    expect((await api.card(cards[0][0].id)).column_id).toBe(cols[0].id);
  });

  test('move body is validated', async ({ api }) => {
    const { cols, cards } = await api.seedBoard([1, 0, 0]);
    await expectError(await api.raw.post(`/api/cards/${cards[0][0].id}/move`, { position: 0 }), 422, 'validation_error');
    await expectError(await api.raw.post(`/api/cards/${cards[0][0].id}/move`, { column_id: cols[1].id }), 422, 'validation_error');
  });

  test('randomised sequence of 60 moves matches the reference model', async ({ api }) => {
    test.setTimeout(120_000);
    const board = await api.createBoard();
    const extra = await api.createColumn(board.id, 'Extra');
    const columnIds = [...board.columns.map((c) => c.id), extra.id];
    const model = new Map<number, number[]>(columnIds.map((id) => [id, []]));
    const rand = rng(20260930);
    const allCards: number[] = [];
    for (let i = 0; i < 16; i++) {
      const col = columnIds[Math.floor(rand() * columnIds.length)];
      const card = await api.createCard(col, `R${i}`);
      model.get(col)!.push(card.id);
      allCards.push(card.id);
    }
    await expectLayout(api, board.id, model, 'after create');
    for (let step = 1; step <= 60; step++) {
      const cardId = allCards[Math.floor(rand() * allCards.length)];
      const col = columnIds[Math.floor(rand() * columnIds.length)];
      const position = Math.floor(rand() * 9) - 2; // includes negatives and out-of-range values
      await api.moveCard(cardId, col, position);
      applyCardMove(model, cardId, col, position);
      if (step % 5 === 0) await expectLayout(api, board.id, model, `step ${step} (card ${cardId} → col ${col} @ ${position})`);
    }
  });
});

test.describe('WIP limits', { tag: '@moves' }, () => {
  test('creating a card in a full column returns 409 wip_limit_reached', async ({ api }) => {
    const b = await api.createBoard();
    const col = await api.patchColumn(b.columns[1].id, { wip_limit: 2 });
    await api.createCard(col.id, 'one');
    await api.createCard(col.id, 'two');
    await expectError(await api.raw.post(`/api/columns/${col.id}/cards`, { title: 'three' }), 409, 'wip_limit_reached');
    expect((await api.board(b.id)).columns[1].cards).toHaveLength(2);
  });

  test('moving a card into a full column returns 409 and leaves everything unchanged', async ({ api }) => {
    const { board, cols, cards } = await api.seedBoard([3, 1, 0]);
    await api.patchColumn(cols[1].id, { wip_limit: 1 });
    const before = await api.layout(board.id);
    await expectError(await api.raw.post(`/api/cards/${cards[0][1].id}/move`, { column_id: cols[1].id, position: 0 }), 409, 'wip_limit_reached');
    expect(await api.layout(board.id)).toEqual(before);
    expect((await api.card(cards[0][1].id))).toMatchObject({ column_id: cols[0].id, position: 1 });
  });

  test('reordering inside a full column is allowed', async ({ api }) => {
    const { board, cols, cards } = await api.seedBoard([0, 2, 0]);
    await api.patchColumn(cols[1].id, { wip_limit: 2 });
    await api.moveCard(cards[1][0].id, cols[1].id, 1);
    expect((await api.layout(board.id))[1].cardIds).toEqual([cards[1][1].id, cards[1][0].id]);
  });

  test('lowering the limit below the count is allowed; the column then refuses cards until under the limit', async ({ api }) => {
    const { cols, cards } = await api.seedBoard([3, 0, 0]);
    const col = await api.patchColumn(cols[0].id, { wip_limit: 1 });
    expectColumn(col);
    expect(col).toMatchObject({ wip_limit: 1, card_count: 3 });
    await expectError(await api.raw.post(`/api/columns/${cols[0].id}/cards`, { title: 'nope' }), 409, 'wip_limit_reached');
    await api.moveCard(cards[0][0].id, cols[1].id, 0);
    await api.moveCard(cards[0][1].id, cols[1].id, 0);
    await expectError(await api.raw.post(`/api/columns/${cols[0].id}/cards`, { title: 'still full' }), 409, 'wip_limit_reached');
    await api.moveCard(cards[0][2].id, cols[1].id, 0);
    expect((await api.createCard(cols[0].id, 'fits now')).column_id).toBe(cols[0].id);
    await api.patchColumn(cols[0].id, { wip_limit: null });
    await api.createCard(cols[0].id, 'unlimited again');
  });
});

test.describe('column moves', { tag: '@moves' }, () => {
  test('POST /api/columns/{id}/move returns all columns in the new order', async ({ api }) => {
    const b = await api.createBoard();
    const extra = await api.createColumn(b.id, 'Extra');
    const [todo, doing, done] = b.columns.map((c) => c.id);
    const res = await api.moveColumn(todo, 2);
    res.forEach(expectColumn);
    expect(res.map((c) => c.id)).toEqual([doing, done, todo, extra.id]);
    expectContiguous(res, 'moved columns');
    expect((await api.board(b.id)).columns.map((c) => c.id)).toEqual([doing, done, todo, extra.id]);
  });

  test('column positions are clamped and cards travel with their column', async ({ api }) => {
    const { board, cols, cards } = await api.seedBoard([0, 0, 2]);
    expect((await api.moveColumn(cols[2].id, -3)).map((c) => c.id)).toEqual([cols[2].id, cols[0].id, cols[1].id]);
    expect((await api.moveColumn(cols[2].id, 50)).map((c) => c.id)).toEqual([cols[0].id, cols[1].id, cols[2].id]);
    const detail = await api.board(board.id);
    expect(detail.columns[2].cards.map((c) => c.id)).toEqual(cards[2].map((c) => c.id));
    await expectError(await api.raw.post('/api/columns/987654321/move', { position: 0 }), 404, 'not_found');
  });

  test('randomised column moves keep positions contiguous', async ({ api }) => {
    const b = await api.createBoard();
    for (const n of ['D', 'E', 'F']) await api.createColumn(b.id, n);
    let model = (await api.board(b.id)).columns.map((c) => c.id);
    const rand = rng(42);
    for (let i = 0; i < 15; i++) {
      const id = model[Math.floor(rand() * model.length)];
      const pos = Math.floor(rand() * 8) - 1;
      const res = await api.moveColumn(id, pos);
      const rest = model.filter((x) => x !== id);
      rest.splice(Math.max(0, Math.min(pos, rest.length)), 0, id);
      model = rest;
      expect(res.map((c) => c.id), `column move ${i}`).toEqual(model);
      expectContiguous(res, `column move ${i}`);
    }
  });
});
