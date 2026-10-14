// The embedded canvas carries each font face whole into an SVG export. Glyph
// subsetting runs harfbuzz and woff2 as WebAssembly, which a host whose
// script-src lacks 'wasm-unsafe-eval' (the Cerebrate Portal's) refuses — and
// the refusal took the page down with it. This module stands in for
// packages/excalidraw/subset/subset-main.ts and leaves both out of the build.
export const subsetWoff2GlyphsByCodepoints = async (
  arrayBuffer: ArrayBuffer,
  _codePoints: Array<number>,
): Promise<string> => {
  const bytes = new Uint8Array(arrayBuffer);
  let byteString = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    byteString += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:font/woff2;base64,${btoa(byteString)}`;
};
