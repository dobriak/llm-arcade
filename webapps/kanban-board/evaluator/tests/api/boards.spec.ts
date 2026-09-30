import { test, expect } from '../../lib/fixtures.js';
import { expectBoardDetail, expectBoardSummary, expectError, expectValidationError, uniq } from '../../lib/api.js';

test.describe('health & generic errors', { tag: '@api' }, () => {
  test('GET /api/health reports ok with a JSON body', async ({ api }) => {
    const res = await api.raw.get('/api/health');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });

  test('unknown /api route returns the 404 error envelope', async ({ api }) => {
    await expectError(await api.raw.get('/api/definitely-not-a-route'), 404, 'not_found');
  });

  test('malformed JSON body returns 400 bad_request', async ({ request }) => {
    const res = await request.post('/api/boards', { headers: { 'content-type': 'application/json' }, data: '{"name": "x",' });
    await expectError(res, 400, 'bad_request');
  });

  test('non-integer id in path returns 404 or 422', async ({ api }) => {
    await expectError(await api.raw.get('/api/boards/abc'), [404, 422]);
  });

  test('unknown JSON fields are ignored', async ({ api }) => {
    const res = await api.raw.post('/api/boards', { name: uniq('Extra'), bogus_field: 42 });
    expect(res.status()).toBe(201);
  });
});

test.describe('boards', { tag: '@api' }, () => {
  test('POST /api/boards creates a board with the three default columns', async ({ api }) => {
    const name = uniq('Default cols');
    const res = await api.raw.post('/api/boards', { name });
    expect(res.status()).toBe(201);
    const b = await res.json();
    expectBoardDetail(b);
    expect(b.name).toBe(name);
    expect(b.description).toBe('');
    expect(b.labels).toEqual([]);
    expect(b.columns.map((c) => [c.name, c.position, c.wip_limit, c.card_count, c.cards.length])).toEqual([
      ['To Do', 0, null, 0, 0],
      ['In Progress', 1, null, 0, 0],
      ['Done', 2, null, 0, 0],
    ]);
    for (const c of b.columns) expect(c.board_id).toBe(b.id);
  });

  test('board name and description are stored; name is trimmed', async ({ api }) => {
    const name = uniq('Trim');
    const b = await api.createBoard(`   ${name}   `, 'A description');
    expect(b.name).toBe(name);
    expect(b.description).toBe('A description');
  });

  for (const [label, body, field] of [
    ['missing name', {}, 'name'],
    ['empty name', { name: '' }, 'name'],
    ['whitespace-only name', { name: '    ' }, 'name'],
    ['name longer than 100', { name: 'x'.repeat(101) }, 'name'],
    ['description longer than 1000', { name: 'ok', description: 'd'.repeat(1001) }, 'description'],
  ] as const) {
    test(`POST /api/boards rejects ${label} with 422`, async ({ api }) => {
      await expectValidationError(await api.raw.post('/api/boards', body), field);
    });
  }

  test('boundary lengths are accepted (name 100, description 1000)', async ({ api }) => {
    const res = await api.raw.post('/api/boards', { name: 'n'.repeat(100), description: 'd'.repeat(1000) });
    expect(res.status()).toBe(201);
  });

  test('GET /api/boards lists summaries, newest first, with card counts', async ({ api }) => {
    const a = await api.createBoard(uniq('List A'));
    const b = await api.createBoard(uniq('List B'));
    await api.createCard(b.columns[0].id, 'one');
    await api.createCard(b.columns[1].id, 'two');
    const list = await api.boards();
    list.forEach(expectBoardSummary);
    const ids = list.map((x) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    const sorted = [...list].sort((x, y) => y.created_at.localeCompare(x.created_at));
    expect(list.map((x) => x.created_at), 'ordered by created_at desc').toEqual(sorted.map((x) => x.created_at));
    expect(list.find((x) => x.id === b.id)!.card_count).toBe(2);
    expect(list.find((x) => x.id === a.id)!.card_count).toBe(0);
  });

  test('GET /api/boards/{id} returns 404 for an unknown board', async ({ api }) => {
    await expectError(await api.raw.get('/api/boards/987654321'), 404, 'not_found');
  });

  test('PATCH /api/boards/{id} updates only the provided fields', async ({ api }) => {
    const b = await api.createBoard(uniq('Patch'), 'keep me');
    const renamed = uniq('Renamed');
    const p1 = await api.patchBoard(b.id, { name: renamed });
    expectBoardDetail(p1);
    expect(p1.name).toBe(renamed);
    expect(p1.description).toBe('keep me');
    expect(p1.columns).toHaveLength(3);
    const p2 = await api.patchBoard(b.id, { description: 'new desc' });
    expect(p2.name).toBe(renamed);
    expect(p2.description).toBe('new desc');
    expect(p2.updated_at >= b.updated_at).toBe(true);
    const p3 = await api.patchBoard(b.id, {});
    expect([p3.name, p3.description]).toEqual([renamed, 'new desc']);
  });

  test('PATCH /api/boards/{id} validates and 404s', async ({ api }) => {
    const b = await api.createBoard();
    await expectValidationError(await api.raw.patch(`/api/boards/${b.id}`, { name: '' }), 'name');
    await expectError(await api.raw.patch('/api/boards/987654321', { name: 'x' }), 404, 'not_found');
  });

  test('DELETE /api/boards/{id} returns 204 and cascades to columns, cards and labels', async ({ api }) => {
    const b = await api.createBoard();
    const label = await api.createLabel(b.id, 'doomed');
    const card = await api.createCard(b.columns[0].id, { title: 'doomed card', label_ids: [label.id] });
    const res = await api.deleteBoard(b.id);
    expect(res.status()).toBe(204);
    expect((await res.body()).length).toBe(0);
    await expectError(await api.raw.get(`/api/boards/${b.id}`), 404, 'not_found');
    await expectError(await api.raw.get(`/api/cards/${card.id}`), 404, 'not_found');
    await expectError(await api.raw.patch(`/api/columns/${b.columns[0].id}`, { name: 'x' }), 404, 'not_found');
    await expectError(await api.raw.patch(`/api/labels/${label.id}`, { name: 'x' }), 404, 'not_found');
    await expectError(await api.deleteBoard(b.id), 404, 'not_found');
  });

  test('responses are JSON with snake_case keys', async ({ api }) => {
    const b = await api.createBoard();
    const res = await api.raw.get(`/api/boards/${b.id}`);
    expect(res.headers()['content-type']).toContain('application/json');
    const text = await res.text();
    expect(text).not.toMatch(/"(createdAt|updatedAt|boardId|columnId|wipLimit|cardCount|dueDate)"/);
  });
});
