/* 极简 preload：只暴露版本号，页面拿不到任何 Node 能力 */
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('APP_ENV', {
  desktop: true,
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome }
});
