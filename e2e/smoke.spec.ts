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

test('verifies HSV color wheel, M shortcut, W/H lock, Alt+Drag, Ctrl+L, Ctrl+2, effects and SettingsModal scroll', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Создать документ' }).click();
  await expect(page.locator('[data-tour="canvas.root"]')).toBeVisible();

  // Create a shape with Smart Shape tool
  await page.locator('[data-tour="tool.blob"]').click();
  const canvasBox = await page.locator('[data-tour="canvas.root"] canvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  const cx = canvasBox!.x + canvasBox!.width / 2;
  const cy = canvasBox!.y + canvasBox!.height / 2;
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-tour="layers.list"] li')).toHaveCount(1);

  // Switch back to Select (V) and check HSV ColorField wheel popover
  await page.keyboard.press('KeyV');
  const colorBtn = page.locator('[data-tour="inspector.root"]').getByRole('button', { name: 'Цвет', exact: true }).nth(1);
  await colorBtn.click();
  await expect(page.getByLabel('Цветовой круг')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Яркость цвета' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Test W / H with aspect ratio lock
  const wInput = page.locator('[data-tour="inspector.transform"] label:has-text("W (px)") input');
  const hInput = page.locator('[data-tour="inspector.transform"] label:has-text("H (px)") input');
  const prevH = Number(await hInput.inputValue());
  await page.getByRole('button', { name: 'Связать пропорции' }).click();
  await wInput.fill('240');
  await wInput.press('Enter');
  expect(Number(await hInput.inputValue())).not.toBe(prevH);

  // Test M shortcut for Shape Builder
  await page.keyboard.press('KeyM');
  await expect(page.locator('[data-tour="tool.shapeBuilder"]')).toHaveAttribute('class', /bg-paper-accent/);
  await page.keyboard.press('KeyV');

  // Test Alt + Drag duplication on canvas
  await page.keyboard.down('Alt');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.locator('[data-tour="layers.list"] li')).toHaveCount(2);

  // Test Ctrl+2 (Zoom to Selection) and Ctrl+L (Toggle Lock)
  await page.keyboard.press('Control+Digit2');
  await page.keyboard.press('Control+KeyL');
  await expect(page.locator('[data-tour="layers.list"] li')).toHaveCount(2);

  // Test grouped effects menu (+ Добавить -> Размытие -> Размытие в движении)
  await page.keyboard.press('Control+KeyL');
  await page.locator('[data-tour="inspector.effects"]').getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText('Размытие в движении (Motion)')).toBeVisible();
  await page.getByText('Размытие в движении (Motion)').click();
  await expect(page.getByText('Размытие в движении')).toBeVisible();

  // Test SettingsModal on small viewport height & scroll reset on tab switch
  await page.setViewportSize({ width: 1024, height: 460 });
  await page.keyboard.press('Control+Comma');
  const modalHeading = page.getByText('Настройки Locus');
  await expect(modalHeading).toBeVisible();
  const box = await modalHeading.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: 'Холст и привязки' }).click();
  await expect(page.getByText('Удерживайте Ctrl при перетаскивании')).toBeVisible();
  await page.keyboard.press('Escape');

  // Test "..." extended tools drawer & circle text preset
  await page.locator('[data-tour="toolbar.more"]').click();
  const drawer = page.locator('[data-toolbar-popover="true"]');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('menuitem', { name: 'Создать текст по кругу' }).click();
  await expect(page.locator('[data-tour="layers.list"] li')).toHaveCount(3);

  expect(pageErrors).toEqual([]);
});
