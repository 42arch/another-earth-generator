import type { WorldSimulationState } from '@/core/simulation/state'
import { describe, expect, it } from 'vitest'
import { evaluateRasterField, RasterSurfaceRenderer } from '@/core/rendering/shared/surfaces/raster-surface-renderer'

describe('rasterSurfaceRenderer', () => {
  const createMockWorldData = (): WorldSimulationState => {
    return {
      geography: {
        elevation: Float32Array.from([-1.0, 0.5, 2.0, 5.0]),
        landMask: Uint8Array.from([0, 1, 1, 1]),
        continentId: Int16Array.from([-1, 0, 0, 1]),
        visibleContinentId: Int16Array.from([-1, 0, 0, 1]),
        terrainFields: {
          overridingInfluence: new Float32Array(4),
          subductingInfluence: new Float32Array(4),
        },
        terrainErosion: {
          flowAccumulation: new Float32Array(4),
          glacialIndex: new Float32Array(4),
        },
      },
      geology: {
        regionSuperPlate: Int16Array.from([0, 0, 1, 1]),
        mantleFlow: new Float32Array(4),
        tectonics: {
          regionStress: new Float32Array(4),
          regionCrustType: new Uint8Array(4),
          regionSubductionRole: new Uint8Array(4),
        },
      },
      climate: {
        displayMonth: {
          temperatureC: Float32Array.from([-20, 0, 15, 30]),
          precipitationMm: Float32Array.from([10, 50, 200, 500]),
        },
        displayWindVector: {
          month: 0,
          kind: 'wind',
          east: Float32Array.from([0.1, 0.4, 0.8, 1.2]),
          north: Float32Array.from([0.0, 0.2, 0.3, 0.4]),
        },
        displayOceanVector: {
          month: 0,
          kind: 'ocean-current',
          east: Float32Array.from([0.8, 0.5, 0.2, 0.1]),
          north: Float32Array.from([0.6, 0.3, 0.1, 0.0]),
          warmth: Float32Array.from([0.9, -0.2, 0.0, 0.5]),
        },
      },
      biome: {
        biomeClass: new Uint8Array(4),
      },
    } as unknown as WorldSimulationState
  }

  it('renders dem field using standard scientific fallback when mesh is absent', () => {
    const renderer = new RasterSurfaceRenderer()
    const data = createMockWorldData()
    const colors = renderer.render(data, 'dem')

    expect(colors).toHaveLength(12)
    // 海洋 (index 0) 应该为黑色 [0, 0, 0]
    expect(colors[0]).toBe(0)
    expect(colors[1]).toBe(0)
    expect(colors[2]).toBe(0)

    // 陆地高程递增，亮度递增
    const getLum = (idx: number) => colors[idx * 3]
    expect(getLum(1)).toBeGreaterThan(0)
    expect(getLum(2)).toBeGreaterThan(getLum(1))
    expect(getLum(3)).toBeGreaterThan(getLum(2))
  })

  it('renders temperature and precipitation fields correctly', () => {
    const renderer = new RasterSurfaceRenderer()
    const data = createMockWorldData()

    const tempColors = renderer.render(data, 'temperature')
    expect(tempColors).toHaveLength(12)
    // 低温与高温颜色不同
    expect(tempColors[0]).not.toEqual(tempColors[9])

    const precipColors = renderer.render(data, 'precipitation')
    expect(precipColors).toHaveLength(12)
    expect(precipColors[0]).not.toEqual(precipColors[9])
  })

  it('renders prevailing wind and ocean current continuous fields correctly', () => {
    const renderer = new RasterSurfaceRenderer()
    const data = createMockWorldData()

    // 盛行风全球连续插值
    const windColors = renderer.render(data, 'wind')
    expect(windColors).toHaveLength(12)
    // 微风(index 0) 与 强风(index 3) 颜色必须有显著梯度，不是单一固定颜色
    expect(windColors[0]).not.toEqual(windColors[9])
    const hasWindVariation = Array.from(windColors).some(c => c > 0)
    expect(hasWindVariation).toBe(true)

    // 大洋环流流速插值（海洋有流速阶梯，陆地受掩膜控制）
    const oceanColors = renderer.render(data, 'ocean-current')
    expect(oceanColors).toHaveLength(12)
    // 海洋(index 0) 与 陆地(index 1) 着色不同
    expect(oceanColors[0]).not.toEqual(oceanColors[3])
    // 陆地区域应该有颜色（非空）
    expect(Array.from(oceanColors).some(c => c > 0)).toBe(true)
  })

  it('renders thematic area basemaps with styled tokens', () => {
    const renderer = new RasterSurfaceRenderer()
    const data = createMockWorldData()
    const colors = renderer.render(data, 'polities', undefined, false, 'standard')

    expect(colors).toHaveLength(12)
    // 陆地与海洋颜色应来自 standard 主题 tokens
    const oceanR = colors[0]
    const landR = colors[3]
    expect(oceanR).not.toEqual(landR)
  })

  it('evaluates raster field directly from style expressions without any layer coupling', () => {
    const fields = {
      val: Float32Array.from([0, 5, 10]),
    }
    const expression = [
      'interpolate',
      [
        'linear',
      ],
      [
        'get',
        'val',
      ],
      0,
      '#000000',
      10,
      '#ffffff',
    ] as const
    const colors = evaluateRasterField(expression, fields, 3, { tokens: {} })
    expect(colors).toHaveLength(9)
    // val = 0 -> black
    expect(colors[0]).toBe(0)
    // val = 10 -> white
    expect(colors[6]).toBe(1)
    // val = 5 -> intermediate brightness
    expect(colors[3]).toBeGreaterThan(0)
    expect(colors[3]).toBeLessThan(1)
  })

  it('correctly discovers, evaluates visibility, and renders standard raster surface layers', async () => {
    const { getRasterStyleLayer, isMapStyleLayerVisible } = await import('@/core/styles')
    const renderer = new RasterSurfaceRenderer()
    const data = createMockWorldData()

    const modes = [
      'dem',
      'heightmap',
      'temperature',
      'precipitation',
      'population',
      'market-access',
      'glacial',
      'geometric-flow',
      'wind',
      'ocean-current',
    ]

    for (const mode of modes) {
      const layer = getRasterStyleLayer('standard', mode)
      expect(layer, `Layer for mode "${mode}" must be discovered`).toBeDefined()
      expect(isMapStyleLayerVisible('standard', layer!.id, 0, 'globe')).toBe(true)
      expect(isMapStyleLayerVisible('standard', layer!.id, 0, 'map')).toBe(true)

      const colors = renderer.render(data, mode, undefined, false, 'standard')
      expect(colors).toHaveLength(12)
      // 至少有一种颜色分量大于0（不是纯黑全零空缓冲区，或dem海洋模式）
      const hasNonZero = Array.from(colors).some(c => c > 0)
      expect(hasNonZero, `Mode "${mode}" must render visible non-empty colors`).toBe(true)
    }
  })
})
