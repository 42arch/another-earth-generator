export function extractTransferables(obj: any): Transferable[] {
  const transferables: Transferable[] = []
  const visited = new Set<any>()

  function walk(node: any) {
    if (node === null || typeof node !== 'object')
      return

    if (visited.has(node))
      return
    visited.add(node)

    if (ArrayBuffer.isView(node)) {
      if (node.buffer instanceof ArrayBuffer && !transferables.includes(node.buffer)) {
        transferables.push(node.buffer)
      }
      return
    }

    if (node instanceof ArrayBuffer) {
      if (!transferables.includes(node)) {
        transferables.push(node)
      }
      return
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item)
      }
      return
    }

    for (const key of Object.keys(node)) {
      walk(node[key])
    }
  }

  walk(obj)
  return transferables
}
