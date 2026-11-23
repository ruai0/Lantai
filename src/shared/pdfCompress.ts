/**
 * PDF 压缩的统一口径。
 *
 * 原先「压缩」页签默认 150 DPI / 80%，工作台「压缩后导出」默认 120 DPI / 70%，
 * 同一件事两套默认值，用户会问"为什么同样的文件两边压出来不一样"。
 * 默认值收到这里，两处引用同一份，改也只改一处。
 *
 * 默认选 150/80 而非更省的 120/70：公文常含小字表格与印章，
 * 120 DPI 压出来容易糊成一团，宁可少压一点也别毁内容；觉得不够小可以自己往下调。
 */
export const PDF_COMPRESS_DEFAULT_DPI = 150
export const PDF_COMPRESS_DEFAULT_QUALITY = 80

/** 可调范围（滑杆边界），两处共用，避免一边能拉到 30、一边只能 40 */
export const PDF_COMPRESS_DPI_MIN = 72
export const PDF_COMPRESS_DPI_MAX = 300
export const PDF_COMPRESS_QUALITY_MIN = 30
export const PDF_COMPRESS_QUALITY_MAX = 95

/** 体积预警阈值：超过就提示先压缩再发（邮件与多数上传系统的常见门槛） */
export const PDF_BIG_BYTES = 10 * 1024 * 1024
