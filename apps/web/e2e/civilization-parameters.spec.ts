import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

test.use({ locale: 'zh-CN', actionTimeout: 10_000 })

async function setSlider(page: Page, name: string, value: number): Promise<void> {
  const slider = page.getByRole('slider', { name, exact: true })
  const min = Number(await slider.getAttribute('aria-valuemin'))
  const step = ['细分等级', '国家数量'].includes(name) ? 1 : 0.05
  await slider.press('Home')
  for (let i = 0; i < Math.round((value - min) / step); i++)
    await slider.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', String(value))
}

test('civilization capabilities and layout survive real Worker generation and sharing', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    const state = window as unknown as { completed: { parameters: unknown, stages: string[] }[] }
    state.completed = []
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'COMPLETED' && data.world) {
            state.completed.push({
              parameters: data.world.metadata.generationConfig.civilization,
              stages: data.stages.filter((stage: { action: string }) => stage.action === 'execute').map((stage: { stageId: string }) => stage.stageId),
            })
          }
        })
      }
    }
  })
  await page.goto('/?autogenerate=0')
  await page.getByLabel('参数', { exact: true }).click()
  await setSlider(page, '细分等级', 4)
  await page.getByRole('textbox', { name: '随机种子', exact: true }).fill('m2-civilization-seed')
  await page.getByRole('tab', { name: '文明', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '社会背景预设', exact: true })).toContainText('近代工业商贸')
  const countryCount = page.getByRole('slider', { name: '国家数量', exact: true })
  await expect(countryCount).toHaveAttribute('aria-valuemin', '1')
  await expect(countryCount).toHaveAttribute('aria-valuemax', '200')
  await expect(countryCount).toHaveAttribute('aria-valuenow', '60')
  await countryCount.press('End')
  await expect(countryCount).toHaveAttribute('aria-valuenow', '200')
  await countryCount.press('Home')
  await expect(countryCount).toHaveAttribute('aria-valuenow', '1')
  await setSlider(page, '农业生产能力', 1.5)
  await setSlider(page, '工业利用能力', 0.5)
  await setSlider(page, '陆运能力', 1.5)
  await setSlider(page, '航海能力', 0)
  await setSlider(page, '行政整合能力', 0.8)
  await setSlider(page, '聚居倾向', 0.75)
  await setSlider(page, '国家数量', 6)
  await setSlider(page, '国家面积差异', 0.8)
  await setSlider(page, '文化多样性', 1.5)
  await expect(page.getByRole('combobox', { name: '社会背景预设', exact: true })).toContainText('自定义')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page).toHaveURL(/#w=15\./, { timeout: 120_000 })
  const firstUrl = page.url()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const first = await page.evaluate(() => (window as unknown as { completed: { parameters: unknown }[] }).completed[0]!.parameters)
  expect(first).toMatchObject({
    urbanConcentration: 0.75,
    polityCount: 6,
    politySizeVariation: 0.8,
    culturalDiversity: 1.5,
    capabilities: { agriculturalProductivity: 1.5, industrialCapability: 0.5, landTransportCapability: 1.5, seafaringCapability: 0, administrativeCapacity: 0.8 },
  })
  await setSlider(page, '行政整合能力', 0.2)
  expect(await page.evaluate(() => (window as unknown as { completed: unknown[] }).completed.length)).toBe(1)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await page.waitForFunction(() => (window as unknown as { completed: unknown[] }).completed.length === 2)
  const second = await page.evaluate(() => (window as unknown as { completed: { stages: string[] }[] }).completed[1]!)
  expect(second.stages).toEqual(['polities-religions'])
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled()
  await expect(page).not.toHaveURL(firstUrl)
  await page.reload()
  await page.getByLabel('参数', { exact: true }).click()
  await page.getByRole('tab', { name: '文明', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '社会背景预设', exact: true })).toContainText('自定义')
  await expect(page.getByRole('slider', { name: '聚居倾向', exact: true })).toHaveAttribute('aria-valuenow', '0.75')
  await expect(page.getByRole('slider', { name: '行政整合能力', exact: true })).toHaveAttribute('aria-valuenow', '0.2')
  await expect(page.getByRole('slider', { name: '国家数量', exact: true })).toHaveAttribute('aria-valuenow', '6')
  await expect(page.getByRole('slider', { name: '国家面积差异', exact: true })).toHaveAttribute('aria-valuenow', '0.8')
  await expect(page.getByRole('slider', { name: '航海能力', exact: true })).toHaveAttribute('aria-valuenow', '0')
})

test('presets apply scenario values while preserving independent axes and restore from a share link', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/?autogenerate=0')
  await page.getByLabel('参数', { exact: true }).click()
  await setSlider(page, '细分等级', 4)
  await page.getByRole('textbox', { name: '随机种子', exact: true }).fill('civ-preset-browser')
  await page.getByRole('tab', { name: '文明', exact: true }).click()
  const preset = page.getByRole('combobox', { name: '社会背景预设', exact: true })
  await setSlider(page, '人口规模倍率', 1.5)
  await setSlider(page, '文化多样性', 1.5)
  await expect(preset).toContainText('近代工业商贸')
  await preset.click()
  await page.getByRole('option', { name: /^农耕聚落/ }).click()
  await expect(preset).toContainText('农耕聚落')
  for (const [name, value] of [
    ['农业生产能力', '0.25'],
    ['工业利用能力', '0'],
    ['陆运能力', '0.25'],
    ['航海能力', '0.05'],
    ['行政整合能力', '0.2'],
    ['人口规模倍率', '1.5'],
    ['聚落密度倍率', '0.45'],
    ['聚居倾向', '0.1'],
    ['国家面积差异', '0.35'],
    ['文化多样性', '1.5'],
  ])
    await expect(page.getByRole('slider', { name, exact: true })).toHaveAttribute('aria-valuenow', value!)
  await expect(page.getByRole('slider', { name: '国家数量', exact: true })).toHaveAttribute('aria-valuenow', '60')
  await expect(page.getByRole('button', { name: '取消生成', exact: true })).toHaveCount(0)
  await expect(page).not.toHaveURL(/#w=/)
  await setSlider(page, '工业利用能力', 0.5)
  await expect(preset).toContainText('自定义')
  // Keyboard selection uses the same accessible picker as pointer input.
  await preset.focus()
  await preset.press('Enter')
  await page.getByRole('option', { name: /^区域王国/ }).click()
  await expect(page.getByRole('slider', { name: '工业利用能力', exact: true })).toHaveAttribute('aria-valuenow', '0.2')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page).toHaveURL(/#w=15\./, { timeout: 120_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await page.getByLabel('参数', { exact: true }).click()
  await page.getByRole('tab', { name: '文明', exact: true }).click()
  await expect(preset).toContainText('区域王国')
  await expect(page.getByRole('slider', { name: '行政整合能力', exact: true })).toHaveAttribute('aria-valuenow', '0.45')
  await expect(page.getByRole('slider', { name: '人口规模倍率', exact: true })).toHaveAttribute('aria-valuenow', '1.5')
  await expect(page.getByRole('slider', { name: '文化多样性', exact: true })).toHaveAttribute('aria-valuenow', '1.5')
  await expect(page.getByRole('textbox', { name: '随机种子', exact: true })).toHaveValue('civ-preset-browser')
})

test('obsolete parameter links report incompatibility and do not auto-generate', async ({ page }) => {
  await page.goto('/#w=14.AAAA')
  await expect(page.getByRole('alert')).toContainText('参数链接版本不受支持或内容无效')
  await expect(page.getByRole('button', { name: '取消生成', exact: true })).toHaveCount(0)
})
