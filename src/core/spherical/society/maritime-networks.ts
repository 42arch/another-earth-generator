import type SphericalMesh from '@/core/spherical/spherical-mesh'
import type {
  SphericalHumanData,
  SphericalMaritimeContact,
} from '@/core/spherical/society/society-data'

export interface SphericalMaritimeNetworkData {
  settlementNetwork: Int32Array
  networkCount: number
}

export function buildSphericalMaritimeNetworks(
  mesh: SphericalMesh,
  landMask: Uint8Array,
  human: SphericalHumanData,
  acceptsContact: (contact: SphericalMaritimeContact) => boolean = () => true,
): SphericalMaritimeNetworkData {
  const regionComponent = new Int32Array(mesh.numRegions).fill(-1)
  let componentCount = 0
  for (let start = 0; start < mesh.numRegions; start++) {
    if (landMask[start] === 0 || regionComponent[start] >= 0)
      continue
    const queue = [start]
    regionComponent[start] = componentCount
    for (let head = 0; head < queue.length; head++) {
      const region = queue[head]
      for (const neighbor of mesh.forEachNeighborOfRegion(region)) {
        if (landMask[neighbor] !== 0 && regionComponent[neighbor] < 0) {
          regionComponent[neighbor] = componentCount
          queue.push(neighbor)
        }
      }
    }
    componentCount++
  }

  const parent = new Int32Array(componentCount)
  for (let component = 0; component < componentCount; component++)
    parent[component] = component
  const findRoot = (component: number): number => {
    let root = component
    while (parent[root] !== root)
      root = parent[root]
    while (parent[component] !== component) {
      const next = parent[component]
      parent[component] = root
      component = next
    }
    return root
  }
  for (const contact of human.maritimeContacts) {
    if (!acceptsContact(contact))
      continue
    const source = regionComponent[contact.sourceRegion]
    const target = regionComponent[contact.targetRegion]
    if (source < 0 || target < 0)
      continue
    const sourceRoot = findRoot(source)
    const targetRoot = findRoot(target)
    if (sourceRoot !== targetRoot)
      parent[targetRoot] = sourceRoot
  }

  const networkByRoot = new Map<number, number>()
  const settlementNetwork = new Int32Array(human.settlements.length).fill(-1)
  for (let settlement = 0; settlement < human.settlements.length; settlement++) {
    const component = regionComponent[human.settlements[settlement].region]
    if (component < 0)
      continue
    const root = findRoot(component)
    let network = networkByRoot.get(root)
    if (network === undefined) {
      network = networkByRoot.size
      networkByRoot.set(root, network)
    }
    settlementNetwork[settlement] = network
  }
  return { settlementNetwork, networkCount: networkByRoot.size }
}
