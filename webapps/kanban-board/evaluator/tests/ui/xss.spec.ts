import { test, expect } from '../../lib/fixtures.js';
import { byId, card, openBoard } from '../../lib/ui.js';

// Critical (PRD §7.1 / §11): any failure here caps the total score at 40.
const PAYLOADS = {
  img: '<img src=x onerror="window.__xss=1">',
  script: '<script>window.__xss=2</script>',
  svg: '"><svg onload="window.__xss=3">',
  label: '<img src=x onerror=__xss=4>', // ≤ 30 chars
};

test.describe('XSS', { tag: ['@ui', '@xss'] }, () => {
  test('user text is rendered escaped everywhere', async ({ page, api }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });

    const b = await api.createBoard(PAYLOADS.img, PAYLOADS.svg);
    const label = await api.createLabel(b.id, PAYLOADS.label, '#ff0000');
    const c = await api.createCard(b.columns[0].id, { title: PAYLOADS.script, description: PAYLOADS.img, label_ids: [label.id] });
    await api.createColumn(b.id, PAYLOADS.svg.slice(0, 50));

    const executed = () => page.evaluate(() => (window as unknown as { __xss?: number }).__xss);

    await page.goto('/');
    await expect(page.locator(`[data-testid="board-item"][data-board-id="${b.id}"]`)).toContainText('<img');
    expect(await executed(), 'payload executed on the home page').toBeUndefined();

    await openBoard(page, b.id);
    await expect(byId(page, 'board-title')).toContainText('<img');
    await expect(card(page, c.id).getByTestId('card-title')).toContainText('<script>');
    expect(await executed(), 'payload executed on the board page').toBeUndefined();

    await card(page, c.id).click();
    await expect(byId(page, 'card-detail')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await executed(), 'payload executed in the card detail').toBeUndefined();

    await page.keyboard.press('Escape');
    await byId(page, 'labels-open').click();
    await page.waitForTimeout(300);
    expect(await executed(), 'payload executed in label management').toBeUndefined();

    await page.goto(`/boards/${b.id}?q=${encodeURIComponent(PAYLOADS.img)}`);
    await page.waitForTimeout(300);
    expect(await executed(), 'payload executed via the filter query string').toBeUndefined();
    expect(dialogs, 'no dialogs may be triggered by user content').toEqual([]);
  });
});
