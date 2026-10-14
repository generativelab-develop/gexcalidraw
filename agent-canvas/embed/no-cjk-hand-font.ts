// The embedded canvas leaves out the hand-drawn CJK fallback (Xiaolai, ~13 MB
// in 200 files): CJK text in the sketch theme falls back to the system font.
import { type ExcalidrawFontFaceDescriptor } from "../../packages/excalidraw/fonts/Fonts";

export const XiaolaiFontFaces: ExcalidrawFontFaceDescriptor[] = [];
