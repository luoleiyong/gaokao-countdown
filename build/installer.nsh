; 高考倒计时 · NSIS 安装向导扩展
; 作用：在「选择安装目录」之后插入「数据备份位置」页，写入提示文件，
; 程序首次启动时读取一次（设置里未指定时才采用），留空即使用默认位置。
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER

Var BACKUP_DIR_INPUT
Var BACKUP_DIR_BROWSE
Var BACKUP_DIR_VALUE

!macro customPageAfterChangeDir
  Page custom BackupDirPageCreate BackupDirPageLeave
!macroend

Function BackupDirPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ; 覆盖 MUI 顶部的页面标题/副标题（1037/1038 是 MUI2 的头部控件 ID）
  GetDlgItem $0 $HWNDPARENT 1037
  ${If} $0 != 0
    SendMessage $0 ${WM_SETTEXT} 0 "STR:数据备份位置"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  ${If} $0 != 0
    SendMessage $0 ${WM_SETTEXT} 0 "STR:选择备份文件夹，留空使用默认位置。"
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 10u "程序每天首次启动会把数据备份到下面文件夹（保留最近 7 份）："
  Pop $0
  ${NSD_CreateLabel} 0 14u 100% 8u "$APPDATA\GaokaoCountdown\backups"
  Pop $0
  ${NSD_CreateDirRequest} 0 26u 74% 12u ""
  Pop $BACKUP_DIR_INPUT
  ${NSD_CreateBrowseButton} 76% 26u 24% 12u "浏览..."
  Pop $BACKUP_DIR_BROWSE
  ${NSD_OnClick} $BACKUP_DIR_BROWSE BackupDirBrowse
  ${NSD_CreateLabel} 0 44u 100% 24u "可以选一个会同步到网盘或移动硬盘的文件夹；不填写就保存在默认位置。安装完成后可在「设置 - 数据与备份」里更改。"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function BackupDirBrowse
  ${NSD_GetText} $BACKUP_DIR_INPUT $0
  nsDialogs::SelectFolderDialog "选择数据备份文件夹" "$0"
  Pop $1
  ${If} $1 != error
    ${NSD_SetText} $BACKUP_DIR_INPUT "$1"
  ${EndIf}
FunctionEnd

Function BackupDirPageLeave
  ${NSD_GetText} $BACKUP_DIR_INPUT $BACKUP_DIR_VALUE
  ${If} $BACKUP_DIR_VALUE == ""
    Delete "$APPDATA\GaokaoCountdown\install-backup-path.txt"
  ${Else}
    CreateDirectory "$APPDATA\GaokaoCountdown"
    ClearErrors
    FileOpen $0 "$APPDATA\GaokaoCountdown\install-backup-path.txt" w
    ${If} $0 != ""
      FileWrite $0 "$BACKUP_DIR_VALUE"
      FileClose $0
    ${EndIf}
  ${EndIf}
FunctionEnd

!endif

!macro customUnInstall
  Delete "$APPDATA\GaokaoCountdown\install-backup-path.txt"
!macroend