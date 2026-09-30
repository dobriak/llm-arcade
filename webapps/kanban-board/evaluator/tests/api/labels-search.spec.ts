import { test, expect } from '../../lib/fixtures.js';
import { expectError, expectLabel, expectValidationError, todayUtc } from '../../lib/api.js';

test.describe('labels', { tag: '@api' }, () => {
  test('POST /api/boards/{id}/labels creates a label; colour is lowercased, name trimmed', async ({ api }) => {
    const b = await api.createBoard();
    const res = await api.raw.post(`/api/boards/${b.id}/labels`, { name: '  Bug  ', color: '#D73A4A' });
    expect(res.status()).toBe(201);
    const l = await res.json();
    expectLabel(l);
    expect(l).toMatchObject({ board_id: b.id, name: 'Bug', color: '#d73a4a' });
  });

  for (const [label, body, field] of [
    ['missing name', { color: '#aabbcc' }, 'name'],
    ['empty name', { name: '', color: '#aabbcc' }, 'name'],
    ['name longer than 30', { name: 'l'.repeat(31), color: '#aabbcc' }, 'name'],
    ['colour name instead of hex', { name: 'ok', color: 'red' }, 'color'],
    ['short hex colour', { name: 'ok', color: '#abc' }, 'color'],
    ['missing colour', { name: 'ok' }, 'color'],
  ] as const) {
    test(`POST label rejects ${label} with 422`, async ({ api }) => {
      const b = await api.createBoard();
      await expectValidationError(await api.raw.post(`/api/boards/${b.id}/labels`, body), field);
    });
  }

  test('duplicate label names on a board (case-insensitive) return 409 conflict', async ({ api }) => {
    const b = await api.createBoard();
    await api.createLabel(b.id, 'Feature');
    await expectError(await api.raw.post(`/api/boards/${b.id}/labels`, { name: 'feature', color: '#000000' }), 409, 'conflict');
    await expectError(await api.raw.post(`/api/boards/${b.id}/labels`, { name: 'FEATURE ', color: '#000000' }), 409, 'conflict');
    const other = await api.createBoard();
    await api.createLabel(other.id, 'feature');
  });

  test('GET /api/boards/{id}/labels is ordered by name', async ({ api }) => {
    const b = await api.createBoard();
    for (const n of ['m-label', 'a-label', 'z-label']) await api.createLabel(b.id, n);
    expect((await api.labels(b.id)).map((l) => l.name)).toEqual(['a-label', 'm-label', 'z-label']);
    expect((await api.board(b.id)).labels.map((l) => l.name)).toEqual(['a-label', 'm-label', 'z-label']);
    await expectError(await api.raw.get('/api/boards/987654321/labels'), 404, 'not_found');
  });

  test('PATCH /api/labels/{id} renames and recolours; duplicates are 409', async ({ api }) => {
    const b = await api.createBoard();
    const l = await api.createLabel(b.id, 'old', '#111111');
    await api.createLabel(b.id, 'taken');
    const res = await api.raw.patch(`/api/labels/${l.id}`, { name: 'new' });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ id: l.id, name: 'new', color: '#111111' });
    const res2 = await api.raw.patch(`/api/labels/${l.id}`, { color: '#ABCDEF' });
    expect(await res2.json()).toMatchObject({ name: 'new', color: '#abcdef' });
    await expectError(await api.raw.patch(`/api/labels/${l.id}`, { name: 'Taken' }), 409, 'conflict');
    await expectValidationError(await api.raw.patch(`/api/labels/${l.id}`, { color: 'blue' }), 'color');
    await expectError(await api.raw.patch('/api/labels/987654321', { name: 'x' }), 404, 'not_found');
  });

  test('DELETE /api/labels/{id} removes it from cards', async ({ api }) => {
    const b = await api.createBoard();
    const keep = await api.createLabel(b.id, 'keep');
    const drop = await api.createLabel(b.id, 'drop');
    const card = await api.createCard(b.columns[0].id, { title: 'c', label_ids: [keep.id, drop.id] });
    const res = await api.raw.delete(`/api/labels/${drop.id}`);
    expect(res.status()).toBe(204);
    expect((await api.card(card.id)).labels.map((l) => l.id)).toEqual([keep.id]);
    expect((await api.labels(b.id)).map((l) => l.id)).toEqual([keep.id]);
    await expectError(await api.raw.delete(`/api/labels/${drop.id}`), 404, 'not_found');
  });
});

test.describe('search', { tag: '@api' }, () => {
  async function fixture(api: import('../../lib/api.js').Api) {
    const b = await api.createBoard();
    const [todo, doing, done] = b.columns;
    const red = await api.createLabel(b.id, 'red', '#ff0000');
    const blue = await api.createLabel(b.id, 'blue', '#0000ff');
    const c = {
      a: await api.createCard(doing.id, { title: 'Alpha task', priority: 'high', label_ids: [red.id] }),
      b: await api.createCard(todo.id, { title: 'Beta', description: 'mentions ALPHA in text', priority: 'low' }),
      c: await api.createCard(todo.id, { title: 'Gamma', priority: 'high', label_ids: [red.id, blue.id], due_date: todayUtc(2) }),
      d: await api.createCard(done.id, { title: 'Delta', priority: 'medium', label_ids: [blue.id] }),
    };
    return { b, red, blue, c };
  }

  test('no filters returns every card ordered by column then card position', async ({ api }) => {
    const { b, c } = await fixture(api);
    const all = await api.searchCards(b.id, {});
    expect(all.map((x) => x.id)).toEqual([c.b.id, c.c.id, c.a.id, c.d.id]);
  });

  test('q matches title or description case-insensitively', async ({ api }) => {
    const { b, c } = await fixture(api);
    expect((await api.searchCards(b.id, { q: 'alpha' })).map((x) => x.id)).toEqual([c.b.id, c.a.id]);
    expect((await api.searchCards(b.id, { q: 'GAMM' })).map((x) => x.id)).toEqual([c.c.id]);
    expect(await api.searchCards(b.id, { q: 'nothing-matches-this' })).toEqual([]);
  });

  test('priority and label_id filters combine with AND', async ({ api }) => {
    const { b, red, blue, c } = await fixture(api);
    expect((await api.searchCards(b.id, { priority: 'high' })).map((x) => x.id)).toEqual([c.c.id, c.a.id]);
    expect((await api.searchCards(b.id, { label_id: blue.id })).map((x) => x.id)).toEqual([c.c.id, c.d.id]);
    expect((await api.searchCards(b.id, { priority: 'high', label_id: red.id, q: 'alpha' })).map((x) => x.id)).toEqual([c.a.id]);
    expect(await api.searchCards(b.id, { priority: 'urgent' })).toEqual([]);
  });

  test('search on an unknown board returns 404', async ({ api }) => {
    await expectError(await api.raw.get('/api/boards/987654321/cards?q=x'), 404, 'not_found');
  });
});

test.describe('demo seed', { tag: '@api' }, () => {
  test('SEED_DEMO created "Demo Board" with labels, cards, an overdue card and a multi-label card', async ({ api }) => {
    const summary = (await api.boards()).find((b) => b.name === 'Demo Board');
    expect(summary, 'a board named "Demo Board" must exist (SEED_DEMO=true in docker-compose.yaml)').toBeTruthy();
    const b = await api.board(summary!.id);
    expect(b.columns.slice(0, 3).map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done']);
    const labels = Object.fromEntries(b.labels.map((l) => [l.name, l.color]));
    expect(labels).toMatchObject({ bug: '#d73a4a', feature: '#0e8a16', chore: '#6a737d' });
    const cards = b.columns.flatMap((c) => c.cards);
    expect(cards.length).toBeGreaterThanOrEqual(6);
    expect(new Set(cards.map((c) => c.priority)).size, 'mixed priorities').toBeGreaterThan(1);
    expect(cards.some((c) => c.due_date !== null && c.due_date < todayUtc()), 'at least one overdue card').toBe(true);
    expect(cards.some((c) => c.labels.length >= 2), 'at least one card with two labels').toBe(true);
    expect(b.columns.filter((c) => c.cards.length > 0).length, 'cards spread across columns').toBeGreaterThan(1);
  });
});
