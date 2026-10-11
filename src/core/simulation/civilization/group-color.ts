/** Stable display palette shared by both map views and civilization statistics. */
export function civilizationGroupColor(id: number): readonly [number, number, number] {
  const hue = ((id * 0.61803398875 + 0.08) % 1 + 1) % 1
  const saturation = 0.63
  const lightness = 0.58
  const channel = (offset: number) => {
    const k = (offset + hue * 12) % 12
    const a = saturation * Math.min(lightness, 1 - lightness)
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [channel(0), channel(8), channel(4)]
}

export function civilizationGroupCssColor(id: number): string {
  const rgb = civilizationGroupColor(id)
  return `rgb(${rgb.map(value => Math.round(value * 255)).join(', ')})`
}
