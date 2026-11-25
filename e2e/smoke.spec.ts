import { expect, test } from '@playwright/test';

test('creates shape on real Paper.js canvas, runs tutorial spotlight and opens export modal', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');

  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.locator('[data-tour="canvas.root"]')).toBeVisible();

  // Select Smart Shape tool and draw on the Paper.js canvas
  await page.locator('[data-tour="tool.blob"]').click();
  const canvasBox = await page.locator('[data-tour="canvas.root"] canvas').boundingBox();
  expect(canvasBox).not.toBeNull();

  const cx = canvasBox!.x + canvasBox!.width / 2;
  const cy = canvasBox!.y + canvasBox!.height / 2;
  await page.mouse.move(cx - 80, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 60, { steps: 6 });
  await page.mouse.up();

  // Layer appears in Layers panel and canvas has non-empty rasterized content
  await expect(page.locator('[data-tour="layers.list"] li')).toHaveCount(1);
  const hasDrawnPixels = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-tour="canvas.root"] canvas');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, Math.min(canvas.width, 400), Math.min(canvas.height, 400)).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return true;
    }
    return false;
  });
  expect(hasDrawnPixels).toBe(true);

  // Open Academy via F1 and highlight a tool on screen via data-tour
  await page.keyboard.press('F1');
  await expect(page.getByRole('dialog', { name: 'Обучение Locus' })).toBeVisible();
  await page.getByRole('button', { name: /Кривые/i }).click();
  await page.getByRole('button', { name: /Карандаш N/i }).click();
  await page.getByRole('button', { name: 'Показать' }).first().click();

  await expect(page.getByTestId('tutorial-spotlight')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Подсказка обучения' })).toContainText('Линия от руки');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tutorial-spotlight')).toHaveCount(0);

  // Toggle rulers (Ctrl+R) and outline mode (Ctrl+Y), then open raster export modal
  await page.keyboard.press('Control+r');
  await expect(page.getByTitle('Потяните вниз для создания горизонтальной направляющей')).toBeVisible();

  await page.locator('[data-tour="inspector.export"]').getByRole('button', { name: 'Экспорт PNG' }).click();
  await expect(page.getByRole('heading', { name: /Экспорт/i })).toBeVisible();
  await page.keyboard.press('Escape');

  expect(pageErrors).toEqual([]);
});
