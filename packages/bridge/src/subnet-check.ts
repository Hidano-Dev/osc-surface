import type { SubnetVerdict } from '@oscdesk/shared'

export interface NetworkInterfaceInfo {
  address: string
  netmask: string
  family: 'IPv4' | 'IPv6'
  internal: boolean
}

export type OsInterfacesProvider = () => readonly NetworkInterfaceInfo[]

type ParsedIpv4 = readonly [number, number, number, number]

const IPV4_SEGMENT_COUNT = 4

function parseIpv4(value: string): ParsedIpv4 | null {
  const parts = value.split('.')

  if (parts.length !== IPV4_SEGMENT_COUNT) {
    return null
  }

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return null
    }

    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null
    }

    return octet
  })

  if (octets.some((octet) => octet === null)) {
    return null
  }

  return octets as ParsedIpv4
}

function ipv4ToInt(octets: ParsedIpv4): number {
  return (
    ((octets[0] << 24) >>> 0) |
    (octets[1] << 16) |
    (octets[2] << 8) |
    octets[3]
  ) >>> 0
}

function isLoopbackIpv4(octets: ParsedIpv4): boolean {
  return octets[0] === 127
}

export function evaluateSubnetVerdict(
  destinationHost: string,
  interfaces: readonly NetworkInterfaceInfo[],
): SubnetVerdict {
  const destinationIpv4 = parseIpv4(destinationHost)

  if (destinationIpv4 === null) {
    return {
      kind: 'indeterminate',
      reason: destinationHost.includes(':') ? 'ipv6Destination' : 'hostname',
    }
  }

  if (isLoopbackIpv4(destinationIpv4)) {
    return { kind: 'sameHost' }
  }

  for (const networkInterface of interfaces) {
    if (networkInterface.family !== 'IPv4') {
      continue
    }

    const interfaceAddress = parseIpv4(networkInterface.address)
    if (interfaceAddress === null) {
      continue
    }

    if (ipv4ToInt(interfaceAddress) === ipv4ToInt(destinationIpv4)) {
      return { kind: 'sameHost' }
    }
  }

  const candidates = interfaces
    .filter((networkInterface) => networkInterface.family === 'IPv4' && !networkInterface.internal)
    .map((networkInterface) => ({
      info: networkInterface,
      address: parseIpv4(networkInterface.address),
      netmask: parseIpv4(networkInterface.netmask),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        info: NetworkInterfaceInfo
        address: ParsedIpv4
        netmask: ParsedIpv4
      } => candidate.address !== null && candidate.netmask !== null,
    )

  if (candidates.length === 0) {
    return {
      kind: 'indeterminate',
      reason: 'noIpv4Interface',
    }
  }

  const destinationInt = ipv4ToInt(destinationIpv4)

  for (const candidate of candidates) {
    const addressInt = ipv4ToInt(candidate.address)
    const netmaskInt = ipv4ToInt(candidate.netmask)

    if ((destinationInt & netmaskInt) === (addressInt & netmaskInt)) {
      return {
        kind: 'sameSubnet',
        matchedInterface: candidate.info.address,
      }
    }
  }

  return {
    kind: 'differentSubnet',
    checkedInterfaces: candidates.length,
  }
}
