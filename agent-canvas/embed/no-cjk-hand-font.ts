// The embedded canvas leaves out the hand-drawn CJK fallback (Xiaolai, ~13 MB
// in 200 files): Hangul is drawn in the Hangul face each family falls back to
// (HANGUL_FALLBACK_FONT, Gaegu for the sketch theme), other CJK text in the
// system font.
import { type ExcalidrawFontFaceDescriptor } from "../../packages/excalidraw/fonts/Fonts";

export const XiaolaiFontFaces: ExcalidrawFontFaceDescriptor[] = [];
