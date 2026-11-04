import { expect, test } from '@playwright/test'

test('real Worker builds, reuses cache, and recovers after hard cancellation', async ({ page }) => {
  await page.goto('/mesh-debug')
  const generate = page.getByRole('button', { name: 'Generate' })
  const pipeline = page.locator('dt').filter({ hasText: /^Pipeline$/ }).locator('xpath=following-sibling::dd[1]')
  const regions = page.locator('dt').filter({ hasText: /^Regions \/ V$/ }).locator('xpath=following-sibling::dd[1]')
  await page.getByLabel('细分等级').selectOption('2')
  await generate.click()
  await expect(pipeline).toHaveText('Rebuilt')
  await expect(regions).toHaveText('162')
  await generate.click()
  await expect(pipeline).toHaveText('Cache Hit')

  await page.getByLabel('细分等级').selectOption('7')
  await generate.click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(regions).toHaveText('162')
  await page.getByLabel('细分等级').selectOption('2')
  await generate.click()
  await expect(pipeline).toHaveText('Rebuilt')
  await expect(regions).toHaveText('162')
})

test('a Worker stage failure keeps the previous visible mesh', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      override postMessage(message: unknown, transfer?: Transferable[]): void {
        const request = message as { type?: string, input?: { seed?: string, config?: { mesh?: { subdivisionLevel?: number } } } }
        if (request.type === 'GENERATE' && request.input?.seed === 'fail-once') {
          const invalid = { ...request, input: { ...request.input, config: { ...request.input.config, mesh: { ...request.input.config?.mesh, subdivisionLevel: 8 } } } }
          super.postMessage(invalid, transfer ?? [])
          return
        }
        super.postMessage(message, transfer ?? [])
      }
    }
  })
  await page.goto('/mesh-debug')
  const generate = page.getByRole('button', { name: 'Generate' })
  const regions = page.locator('dt').filter({ hasText: /^Regions \/ V$/ }).locator('xpath=following-sibling::dd[1]')
  await generate.click()
  await expect(regions).toHaveText('162')
  await page.getByLabel('Seed').fill('fail-once')
  await generate.click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(regions).toHaveText('162')
  await page.getByLabel('Seed').fill('42')
  await generate.click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(regions).toHaveText('162')
})
