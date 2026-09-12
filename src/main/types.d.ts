declare module 'pizzip' {
  interface PizZipObject {
    name: string
    dir?: boolean
    asText(): string
    asNodeBuffer(): Buffer
  }
  export default class PizZip {
    files: { [key: string]: PizZipObject }
    constructor(data?: Buffer | Uint8Array | ArrayBuffer | string)
    file(name: string): PizZipObject | null
    file(pattern: RegExp): Array<PizZipObject>
    file(name: string, data: Buffer | Uint8Array | ArrayBuffer | string, options?: { binary?: boolean }): this
    generate(options: {
      type: 'nodebuffer' | 'base64' | 'string' | 'uint8array' | 'arraybuffer' | 'blob'
      compression?: string
    }): Buffer
  }
}
