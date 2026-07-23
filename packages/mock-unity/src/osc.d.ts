declare module 'osc' {
  interface OscMetadataArg {
    type: string
    value: unknown
  }

  interface OscTimeTag {
    raw?: [number, number]
    native?: number
  }

  interface OscReadOptions {
    metadata?: boolean
    unpackSingleArgs?: boolean
  }

  interface OscWriteOptions {
    metadata?: boolean
    unpackSingleArgs?: boolean
  }

  interface OscMessage {
    address: string
    args?: OscMetadataArg[] | OscMetadataArg
  }

  interface OscBundle {
    timeTag: OscTimeTag
    packets: Array<OscMessage | OscBundle>
  }

  function readPacket(data: Uint8Array | ArrayBuffer, options?: OscReadOptions): OscMessage | OscBundle
  function writePacket(packet: OscMessage | OscBundle, options?: OscWriteOptions): Uint8Array

  const osc: {
    readPacket: typeof readPacket
    writePacket: typeof writePacket
  }

  export = osc
}
