import { test, expect } from '../../lib/fixtures.js';
import { expectCard, expectContiguous, expectError, expectValidationError, todayUtc } from '../../lib/api.js';

test.describe('cards', { tag: '@api' }, () => {
  test('POST /api/columns/{id}/cards creates a card with defaults, appended', async ({ api }) => {
    const b = await api.createBoard();
    const col = b.columns[0].id;
    const res = await api.raw.post(`/api/columns/${col}/cards`, { title: '  First  ' });
    expect(res.status()).toBe(201);
    const c1 = await res.json();
    expectCard(c1);
    expect(c1).toMatchObject({ column_id: col, title: 'First', description: '', priority: 'medium', due_date: null, position: 0, labels: [] });
    const c2 = await api.createCard(col, 'Second');
    const c3 = await api.createCard(col, 'Third');
    expect([c2.position, c3.position]).toEqual([1, 2]);
    const detail = await api.board(b.id);
    expect(detail.columns[0].cards.map((c) => c.id)).toEqual([c1.id, c2.id, c3.id]);
  });

  test('card with all fields, labels ordered by name', async ({ api }) => {
    const b = await api.createBoard();
    const zeta = await api.createLabel(b.id, 'zeta', '#ff0000');
    const alpha = await api.createLabel(b.id, 'alpha', '#00ff00');
    const card = await api.createCard(b.columns[1].id, {
      title: 'Full', description: 'Some text', priority: 'urgent', due_date: '2030-01-31', label_ids: [zeta.id, alpha.id],
    });
    expect(card).toMatchObject({ title: 'Full', description: 'Some text', priority: 'urgent', due_date: '2030-01-31' });
    expect(card.labels.map((l) => l.name)).toEqual(['alpha', 'zeta']);
    expect(await api.card(card.id)).toMatchObject({ id: card.id, priority: 'urgent', due_date: '2030-01-31' });
  });

  for (const [label, body, field] of [
    ['missing title', {}, 'title'],
    ['empty title', { title: '' }, 'title'],
    ['title longer than 200', { title: 't'.repeat(201) }, 'title'],
    ['description longer than 5000', { title: 'ok', description: 'd'.repeat(5001) }, 'description'],
    ['unknown priority', { title: 'ok', priority: 'extreme' }, 'priority'],
    ['impossible due_date', { title: 'ok', due_date: '2026-13-45' }, 'due_date'],
    ['non-date due_date', { title: 'ok', due_date: 'next tuesday' }, 'due_date'],
  ] as const) {
    test(`POST card rejects ${label} with 422`, async ({ api }) => {
      const b = await api.createBoard();
      await expectValidationError(await api.raw.post(`/api/columns/${b.columns[0].id}/cards`, body), field);
    });
  }

  test('POST card to an unknown column returns 404', async ({ api }) => {
    await expectError(await api.raw.post('/api/columns/987654321/cards', { title: 'x' }), 404, 'not_found');
  });

  test('text is stored verbatim (no HTML escaping in JSON) and unicode round-trips', async ({ api }) => {
    const b = await api.createBoard();
    const title = '<b>bold</b> & "quotes" — Ünïcödé 🚀';
    const card = await api.createCard(b.columns[0].id, { title, description: '<script>x</script>' });
    const fetched = await api.card(card.id);
    expect(fetched.title).toBe(title);
    expect(fetched.description).toBe('<script>x</script>');
  });

  test('GET /api/cards/{id} 404s for an unknown card', async ({ api }) => {
    await expectError(await api.raw.get('/api/cards/987654321'), 404, 'not_found');
  });

  test('PATCH /api/cards/{id} is partial; null clears due_date', async ({ api }) => {
    const b = await api.createBoard();
    const card = await api.createCard(b.columns[0].id, { title: 'Patchable', description: 'desc', priority: 'low', due_date: '2031-05-05' });
    let c = await api.patchCard(card.id, { title: 'Renamed' });
    expectCard(c);
    expect(c).toMatchObject({ title: 'Renamed', description: 'desc', priority: 'low', due_date: '2031-05-05', position: 0 });
    c = await api.patchCard(card.id, { priority: 'high', description: '' });
    expect(c).toMatchObject({ title: 'Renamed', priority: 'high', description: '', due_date: '2031-05-05' });
    c = await api.patchCard(card.id, { due_date: null });
    expect(c.due_date, 'explicit null must clear due_date').toBeNull();
    c = await api.patchCard(card.id, { title: 'Again' });
    expect(c.due_date).toBeNull();
    expect((await api.card(card.id)).due_date).toBeNull();
  });

  test('PATCH card validates fields', async ({ api }) => {
    const b = await api.createBoard();
    const card = await api.createCard(b.columns[0].id, 'v');
    await expectValidationError(await api.raw.patch(`/api/cards/${card.id}`, { title: '' }), 'title');
    await expectValidationError(await api.raw.patch(`/api/cards/${card.id}`, { priority: 'meh' }), 'priority');
    await expectValidationError(await api.raw.patch(`/api/cards/${card.id}`, { due_date: '31/12/2030' }), 'due_date');
    await expectError(await api.raw.patch('/api/cards/987654321', { title: 'x' }), 404, 'not_found');
  });

  test('PATCH label_ids replaces the full label set', async ({ api }) => {
    const b = await api.createBoard();
    const [l1, l2, l3] = [await api.createLabel(b.id, 'one'), await api.createLabel(b.id, 'two'), await api.createLabel(b.id, 'three')];
    const card = await api.createCard(b.columns[0].id, { title: 'Labelled', label_ids: [l1.id, l2.id] });
    expect(card.labels.map((l) => l.id).sort()).toEqual([l1.id, l2.id].sort());
    let c = await api.patchCard(card.id, { label_ids: [l3.id] });
    expect(c.labels.map((l) => l.id)).toEqual([l3.id]);
    c = await api.patchCard(card.id, { title: 'No label change' });
    expect(c.labels.map((l) => l.id), 'absent label_ids keeps labels').toEqual([l3.id]);
    c = await api.patchCard(card.id, { label_ids: [] });
    expect(c.labels).toEqual([]);
  });

  test('labels from another board are rejected with 422', async ({ api }) => {
    const b1 = await api.createBoard();
    const b2 = await api.createBoard();
    const foreign = await api.createLabel(b2.id, 'foreign');
    await expectError(await api.raw.post(`/api/columns/${b1.columns[0].id}/cards`, { title: 'x', label_ids: [foreign.id] }), 422, 'validation_error');
    const card = await api.createCard(b1.columns[0].id, 'mine');
    await expectError(await api.raw.patch(`/api/cards/${card.id}`, { label_ids: [foreign.id] }), 422, 'validation_error');
    expect((await api.card(card.id)).labels).toEqual([]);
  });

  test('DELETE /api/cards/{id} returns 204 and re-packs the column', async ({ api }) => {
    const { board, cards } = await api.seedBoard([4, 0, 0]);
    const res = await api.raw.delete(`/api/cards/${cards[0][1].id}`);
    expect(res.status()).toBe(204);
    expect((await res.body()).length).toBe(0);
    const col = (await api.board(board.id)).columns[0];
    expect(col.cards.map((c) => c.id)).toEqual([cards[0][0].id, cards[0][2].id, cards[0][3].id]);
    expectContiguous(col.cards, 'cards after delete');
    expect(col.card_count).toBe(3);
    await expectError(await api.raw.delete(`/api/cards/${cards[0][1].id}`), 404, 'not_found');
  });

  test('BoardDetail nests cards by position with labels', async ({ api }) => {
    const b = await api.createBoard();
    const l = await api.createLabel(b.id, 'nested');
    await api.createCard(b.columns[2].id, { title: 'n1', label_ids: [l.id], due_date: todayUtc(-1) });
    const detail = await api.board(b.id);
    expect(detail.columns[2].cards).toHaveLength(1);
    expect(detail.columns[2].cards[0].labels.map((x) => x.name)).toEqual(['nested']);
    expect(detail.labels.map((x) => x.name)).toEqual(['nested']);
  });
});
