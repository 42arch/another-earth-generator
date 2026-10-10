export interface Point2D {
  x: number
  y: number
}

/** Returns the segment interval that lies inside an axis-aligned rectangle. */
export function clipSegmentParameterRange(
  start: Point2D,
  end: Point2D,
  minimumX: number,
  maximumX: number,
  minimumY: number,
  maximumY: number,
): readonly [number, number] | null {
  let minimumAmount = 0
  let maximumAmount = 1
  const axes = [
    [start.x, end.x - start.x, minimumX, maximumX],
    [start.y, end.y - start.y, minimumY, maximumY],
  ] as const

  for (const [origin, difference, minimum, maximum] of axes) {
    if (Math.abs(difference) <= Number.EPSILON) {
      if (origin < minimum || origin > maximum)
        return null
      continue
    }

    const amountA = (minimum - origin) / difference
    const amountB = (maximum - origin) / difference
    minimumAmount = Math.max(minimumAmount, Math.min(amountA, amountB))
    maximumAmount = Math.min(maximumAmount, Math.max(amountA, amountB))
    if (minimumAmount > maximumAmount)
      return null
  }

  if (maximumAmount - minimumAmount <= 1e-12)
    return null
  return [minimumAmount, maximumAmount]
}
