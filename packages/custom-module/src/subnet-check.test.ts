import { describe, expect, it } from 'vitest'

import { evaluateSubnetVerdict, type NetworkInterfaceInfo } from './subnet-check'

const BASE_INTERFACES: readonly NetworkInterfaceInfo[] = [
  {
    address: '192.168.10.5',
    netmask: '255.255.255.0',
    family: 'IPv4',
    internal: false,
  },
]

describe('evaluateSubnetVerdict', () => {
  it('returns sameHost for loopback destinations', () => {
    expect(evaluateSubnetVerdict('127.0.0.1', BASE_INTERFACES)).toEqual({ kind: 'sameHost' })
  })

  it('returns sameHost when the destination matches any local IPv4 interface address', () => {
    const interfaces: readonly NetworkInterfaceInfo[] = [
      ...BASE_INTERFACES,
      {
        address: '10.0.0.8',
        netmask: '255.255.255.0',
        family: 'IPv4',
        internal: true,
      },
    ]

    expect(evaluateSubnetVerdict('10.0.0.8', interfaces)).toEqual({ kind: 'sameHost' })
  })

  it('returns sameSubnet when the destination is within a non-internal IPv4 interface subnet', () => {
    expect(evaluateSubnetVerdict('192.168.10.200', BASE_INTERFACES)).toEqual({
      kind: 'sameSubnet',
      matchedInterface: '192.168.10.5',
    })
  })

  it('returns differentSubnet for TEST-NET destinations outside all local IPv4 subnets', () => {
    const interfaces: readonly NetworkInterfaceInfo[] = [
      {
        address: '192.168.10.5',
        netmask: '255.255.255.0',
        family: 'IPv4',
        internal: false,
      },
      {
        address: '10.0.0.5',
        netmask: '255.255.255.0',
        family: 'IPv4',
        internal: false,
      },
    ]

    expect(evaluateSubnetVerdict('203.0.113.10', interfaces)).toEqual({
      kind: 'differentSubnet',
      checkedInterfaces: 2,
    })
  })

  it('handles narrow netmask boundaries correctly', () => {
    const interfaces: readonly NetworkInterfaceInfo[] = [
      {
        address: '198.51.100.10',
        netmask: '255.255.255.254',
        family: 'IPv4',
        internal: false,
      },
    ]

    expect(evaluateSubnetVerdict('198.51.100.11', interfaces)).toEqual({
      kind: 'sameSubnet',
      matchedInterface: '198.51.100.10',
    })
    expect(evaluateSubnetVerdict('198.51.100.12', interfaces)).toEqual({
      kind: 'differentSubnet',
      checkedInterfaces: 1,
    })
  })

  it('returns indeterminate for hostnames without attempting DNS resolution', () => {
    expect(evaluateSubnetVerdict('unity.local', BASE_INTERFACES)).toEqual({
      kind: 'indeterminate',
      reason: 'hostname',
    })
  })

  it('returns indeterminate for IPv6 destinations', () => {
    expect(evaluateSubnetVerdict('fe80::1', BASE_INTERFACES)).toEqual({
      kind: 'indeterminate',
      reason: 'ipv6Destination',
    })
  })

  it('returns indeterminate when there are no usable non-internal IPv4 interfaces', () => {
    const interfaces: readonly NetworkInterfaceInfo[] = [
      {
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        family: 'IPv4',
        internal: true,
      },
      {
        address: 'fe80::abcd',
        netmask: 'ffff:ffff:ffff:ffff::',
        family: 'IPv6',
        internal: false,
      },
    ]

    expect(evaluateSubnetVerdict('192.168.10.25', interfaces)).toEqual({
      kind: 'indeterminate',
      reason: 'noIpv4Interface',
    })
  })

  it('ignores malformed IPv4 interface metadata and still evaluates the remaining candidates', () => {
    const interfaces: readonly NetworkInterfaceInfo[] = [
      {
        address: '192.168.10.5',
        netmask: '255.255.255.0',
        family: 'IPv4',
        internal: false,
      },
      {
        address: '10.0.0.5',
        netmask: '255.255.0.999',
        family: 'IPv4',
        internal: false,
      },
    ]

    expect(evaluateSubnetVerdict('192.168.10.30', interfaces)).toEqual({
      kind: 'sameSubnet',
      matchedInterface: '192.168.10.5',
    })
    expect(evaluateSubnetVerdict('203.0.113.10', interfaces)).toEqual({
      kind: 'differentSubnet',
      checkedInterfaces: 1,
    })
  })
})
