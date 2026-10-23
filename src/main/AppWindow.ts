import {BrowserWindow, app, dialog} from 'electron'
import is from 'electron-is'
import {enable} from '@electron/remote/main'
import {autoUpdater} from 'electron-updater'
import gt from 'semver/functions/gt'

export type UpdateCheckStatus = 'dev' | 'latest' | 'available' | 'error'

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  version?: string
  message: string
}

// 自动管理 window 的状态
export default class AppWindow {
  public win: BrowserWindow
  public closeable = false

  constructor() {
    this.createWindow()
    this.initAutoUpdater()
  }

  private initAutoUpdater() {
    // 开发环境没有 latest.yml，拉起更新检查只会得到一堆报错，直接跳过
    if (!is.production()) {
      return
    }

    // 是否下载更新交给用户决定
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = {
      info: message => console.log('[updater]', message),
      warn: message => console.warn('[updater]', message),
      error: message => console.error('[updater]', message),
      debug: message => console.debug('[updater]', message),
    }

    autoUpdater.on('update-available', info => {
      dialog
        .showMessageBox(this.win, {
          type: 'info',
          title: '更新提示',
          message: `发现新版本 v${info.version}`,
          detail: `当前版本: v${app.getVersion()}\n最新版本: v${info.version}\n\n更新内容:\n${
            info.releaseNotes || '暂无更新说明'
          }`,
          buttons: ['立即更新', '稍后再说'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({response}) => {
          if (response === 0) {
            autoUpdater.downloadUpdate().catch(error => {
              console.error('[updater] 下载更新失败:', error)
              dialog.showErrorBox('下载更新失败', error?.message || '请稍后重试')
            })
          }
        })
    })

    autoUpdater.on('update-downloaded', info => {
      dialog
        .showMessageBox(this.win, {
          type: 'info',
          title: '更新提示',
          message: '更新已下载完成',
          detail: `新版本 v${info.version} 将在重启后安装`,
          buttons: ['立即重启', '稍后重启'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({response}) => {
          if (response === 0) {
            autoUpdater.quitAndInstall()
          }
        })
    })

    // 更新相关的异常只记录日志，不再弹框打扰用户。
    // 启动时的自动检查在弱网 / 无法访问 GitHub 的情况下几乎必然失败，
    // 用户主动检查的结果则通过 checkForUpdates 的返回值反馈给界面。
    autoUpdater.on('error', error => {
      console.error('[updater] error:', error?.message || error)
    })

    // 首屏加载完成后再检查，避免拖慢启动
    this.win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        this.checkForUpdates().catch(error => console.error('[updater] 自动检查更新失败:', error))
      }, 3000)
    })
  }

  /**
   * 检查更新，返回结果供渲染进程提示。
   * 无论成功失败都不会抛出异常，调用方只需要判断 status。
   */
  public async checkForUpdates(): Promise<UpdateCheckResult> {
    if (!is.production()) {
      return {status: 'dev', message: '开发模式下不支持检查更新'}
    }

    try {
      const result = await autoUpdater.checkForUpdates()
      const latestVersion = result?.updateInfo?.version
      if (latestVersion && gt(latestVersion, app.getVersion())) {
        return {status: 'available', version: latestVersion, message: `发现新版本 v${latestVersion}`}
      }
      return {status: 'latest', message: '当前已是最新版本'}
    } catch (error: any) {
      console.error('[updater] 检查更新失败:', error)
      return {status: 'error', message: `检查更新失败：${error?.message || '请检查网络连接后重试'}`}
    }
  }

  private createWindow() {
    this.win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: false,
      webPreferences: {
        webviewTag: true,
        // preload: path.resolve(__dirname, 'preload.js'),
        webSecurity: false, // 不使用网页安全性，跨域
        nodeIntegration: true, // 开启后可在渲染线程 require()
        contextIsolation: false,
      },
    })

    enable(this.win.webContents)

    this.win.on('ready-to-show', () => this.win.show())
    this.win.on('closed', () => (this.win = null))
    this.win.on('close', event => {
      if (!this.closeable) {
        event.preventDefault()
        this.hideWindow()
      }
    })
  }

  public destroy() {
    this.win.destroy()
  }

  public hideWindow = () => {
    // Mac 在全屏状态下隐藏，会出现黑屏情况，做特殊处理
    if (is.macOS()) {
      if (this.win.isFullScreen()) {
        this.win.once('leave-full-screen', () => this.win.hide())
        this.win.setFullScreen(false)
        return
      }
    }
    if (this.win.isVisible()) {
      this.win.hide()
    }
  }

  public showWindow = () => {
    if (!this.win.isVisible()) {
      this.win.show()
    }
    if (this.win.isMinimized()) {
      this.win.restore()
    }
    if (!this.win.isFocused()) {
      this.win.focus()
    }
  }
}
