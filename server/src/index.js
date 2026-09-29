import { createApp } from './app.js';
import { startHolidaySync } from './holiday-sync.js';

const port = Number(process.env.PORT || 8787);
createApp().listen(port, () => {
  console.log(`师枢 EduHub 已启动: http://localhost:${port}`);
});

// 法定节假日数据后台同步：进程启动即跑一次，之后每天一次。
// 失败只回退到内置数据，不影响服务；EDUHUB_HOLIDAY_SYNC=0 可整体关闭。
startHolidaySync();
