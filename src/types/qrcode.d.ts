// Minimal module declaration for the `qrcode` package (no @types shipped).
declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }
  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  const _export: { toDataURL: typeof toDataURL };
  export default _export;
}
