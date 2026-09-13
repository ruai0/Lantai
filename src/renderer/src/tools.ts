import { markRaw, type Component } from 'vue'
import {
  Connection,
  CopyDocument,
  Document,
  EditPen,
  Files,
  FolderChecked,
  Grid,
  Picture,
  Promotion,
  Search
} from '@element-plus/icons-vue'

/** 工具定义：侧栏、首页、命令面板、收藏的唯一数据源 */
export interface ToolDef {
  path: string
  name: string
  desc: string
  /** 侧栏/首页分组标题 */
  group: string
  /** 分组副标题 */
  caption: string
  icon: Component
  /** 命令面板搜索关键词 */
  keywords: string[]
}

export const TOOLS: ToolDef[] = [
  {
    path: '/pdf',
    name: 'PDF 工具',
    desc: '合并 / 拆分 / 删页 / 旋转 / 页码 / 水印 / 盖章 / 压缩 / 提取文字 / 页面整理',
    group: '文档与 PDF',
    caption: '报送、归档、盖章',
    icon: markRaw(Document),
    keywords: ['合并', '拆分', '删除页', '旋转', '页码', '水印', '盖章', '压缩', '提取文字', '转图片', '页面整理', 'pdf']
  },
  {
    path: '/image',
    name: '图片工具',
    desc: '批量压缩、格式转换、水印、长图拼接、证件照排版、贴图遮挡标注',
    group: '文档与 PDF',
    caption: '报送、归档、盖章',
    icon: markRaw(Picture),
    keywords: ['压缩', '格式转换', '水印', '长图', '拼接', '证件照', '图片', '照片', '贴图', '盖章', '马赛克', '打码', '涂黑', '遮挡', '脱敏', '裁剪', '标注']
  },
  {
    path: '/convert',
    name: 'Office 转 PDF',
    desc: 'Word / Excel / PPT 批量转 PDF，调用本机 Office 或 WPS',
    group: '文档与 PDF',
    caption: '报送、归档、盖章',
    icon: markRaw(Promotion),
    keywords: ['word', 'excel', 'ppt', '转pdf', 'office', 'wps']
  },
  {
    path: '/office',
    name: '文档模板填充',
    desc: '模板写 {字段} + 数据表，按行批量生成通知书、证明',
    group: '文档与 PDF',
    caption: '报送、归档、盖章',
    icon: markRaw(Files),
    keywords: ['模板', '填充', '通知书', '证明', 'mailmerge', '批量生成']
  },
  {
    path: '/replace',
    name: '批量查找替换',
    desc: '多个 Word / Excel 一次改文字，适合更名、改日期',
    group: '文档与 PDF',
    caption: '报送、归档、盖章',
    icon: markRaw(Search),
    keywords: ['查找', '替换', '更名', '改日期', '批量替换']
  },
  {
    path: '/excel',
    name: 'Excel 工具',
    desc: '多簿合并、按表/行/列值拆分、CSV 转换、数据脱敏',
    group: '表格与数据',
    caption: '台账、报表、核对',
    icon: markRaw(Grid),
    keywords: ['合并', '拆分', 'csv', '脱敏', 'excel', '表格', '工作表']
  },
  {
    path: '/match',
    name: '表格匹配 / 比对',
    desc: '跨表匹配填充替代 VLOOKUP，名单差异一键出报告',
    group: '表格与数据',
    caption: '台账、报表、核对',
    icon: markRaw(Connection),
    keywords: ['匹配', '比对', 'vlookup', '差异', '核对', '关联']
  },
  {
    path: '/rename',
    name: '重命名 / 归类',
    desc: '批量重命名带冲突预检，按扩展名或日期自动归类',
    group: '文件与效率',
    caption: '整理、清单、小工具',
    icon: markRaw(EditPen),
    keywords: ['重命名', '归类', '改名', '前缀', '序号']
  },
  {
    path: '/filekit',
    name: '文件管理',
    desc: '送审清单导出、重复文件查找、ZIP 打包与批量解压',
    group: '文件与效率',
    caption: '整理、清单、小工具',
    icon: markRaw(FolderChecked),
    keywords: ['清单', '重复文件', 'zip', '打包', '解压', 'md5']
  },
  {
    path: '/tools',
    name: '常用小工具',
    desc: 'JSON、编解码、哈希、二维码生成与识别、提取联系方式、名单加拼音、文本对比',
    group: '文件与效率',
    caption: '整理、清单、小工具',
    icon: markRaw(CopyDocument),
    keywords: ['json', 'base64', 'url', '时间戳', 'uuid', '哈希', '二维码', '拼音', '文本对比', 'diff']
  }
]

/** 按 group 保序分组，供侧栏与首页复用 */
export function groupedTools(): Array<{ title: string; caption: string; tools: ToolDef[] }> {
  const order: string[] = []
  const map = new Map<string, ToolDef[]>()
  for (const t of TOOLS) {
    if (!map.has(t.group)) {
      map.set(t.group, [])
      order.push(t.group)
    }
    map.get(t.group)!.push(t)
  }
  return order.map(g => ({ title: g, caption: map.get(g)![0].caption, tools: map.get(g)! }))
}

export const toolByPath = (path: string): ToolDef | undefined => TOOLS.find(t => t.path === path)
