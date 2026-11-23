; NSIS 自定义卸载钩子：清掉资源管理器右键菜单的注册表项。
; 不清理的话，卸载后菜单里会留一项指向已删除 exe 的「兰台」，点了报错。
; 注意：HKCU\Software\Classes\*\shell 下的 * 要转义成 $\* 才是字面量通配符。
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\Lantai"
!macroend
