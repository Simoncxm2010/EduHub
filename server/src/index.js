import { createApp } from './app.js';

const port = Number(process.env.PORT || 8787);
createApp().listen(port, () => {
  console.log(`师枢 EduHub 已启动: http://localhost:${port}`);
});
