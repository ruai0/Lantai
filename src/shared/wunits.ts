/**
 * OOXML 长度单位换算。docx 里页边距用 twips（二十分之一磅），
 * 字号用半磅值（w:sz val = 磅 × 2），首行缩进可用"字符数"（w:firstLineChars）。
 * 这三个口径最容易搞混，集中在这里，别在业务代码里裸乘。
 */

/** 厘米 → twips（1 inch = 1440 twips，1 inch = 2.54cm） */
export function cmToTwips(cm: number): number {
  return Math.round((cm / 2.54) * 1440)
}

/** 磅 → docx 半磅值（四舍五入到整数，Word 不接受小数） */
export function halfPt(pt: number): number {
  return Math.round(pt * 2)
}

/**
 * 首行缩进"字符数" → twips 的近似值。
 * 仅用于没有 firstLineChars 的兜底路径；首选还是写 w:firstLineChars（随字号自适应）。
 * 一个中文字符宽 ≈ 字号磅值（1pt = 20 twips）。
 */
export function charIndent(chars: number, fontSizePt: number): number {
  return Math.round(chars * fontSizePt * 20)
}

/** twips → 厘米（报告展示用） */
export function twipsToCm(twips: number): number {
  return Math.round((twips / 1440) * 2.54 * 100) / 100
}

/** 半磅值 → 磅（报告展示用） */
export function halfPtToPt(half: number): number {
  return half / 2
}
