<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import Modal from '../../ui/Modal.vue';
import { addDays, fmtDate } from '../../utils';

const router = useRouter();
const auth = useAuthStore();

const feed = ref(null);
const classes = ref([]);
const exporting = ref(false);

/* 日历导入 */
const showImport = ref(false);
const importText = ref('');
const importClassId = ref(null);
const importPreview = ref(null);
const importing = ref(false);

onMounted(async () => {
  try {
    const [f, c] = await Promise.all([api.get('/calendar/feed-url'), api.get('/classes')]);
    feed.value = f;
    classes.value = c.classes;
    if (c.classes.length) importClassId.value = c.classes[0].id;
  } catch (e) {
    toastError(e);
  }
});

const webcalUrl = computed(() => feed.value?.webcal || '');

async function copyFeed() {
  try {
    await navigator.clipboard.writeText(feed.value.url);
    showToast({ type: 'success', message: '订阅地址已复制' });
  } catch {
    showToast('复制失败，请手动选择地址复制');
  }
}

async function resetFeed() {
  try {
    await showConfirmDialog({ title: '重置订阅地址', message: '重置后旧的订阅地址立即失效，需要在手机日历里重新订阅。', confirmButtonText: '重置' });
  } catch {
    return;
  }
  try {
    const d = await api.post('/calendar/feed-token/reset');
    feed.value = { ...feed.value, token: d.token, url: feed.value.url.replace(/token=.*/, `token=${d.token}`), webcal: webcalUrl.value.replace(/token=.*/, `token=${d.token}`) };
    showToast('已重置');
  } catch (e) {
    toastError(e);
  }
}

async function exportIcs() {
  exporting.value = true;
  try {
    const blob = await api.get('/calendar/export.ics', {
      params: { from: addDays(fmtDate(new Date()), -90), to: addDays(fmtDate(new Date()), 180) },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `师枢课表-${fmtDate(new Date())}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast({ type: 'success', message: '已导出 .ics，可直接用手机日历打开' });
  } catch (e) {
    toastError(e);
  } finally {
    exporting.value = false;
  }
}

function openImport() {
  importText.value = '';
  importPreview.value = null;
  showImport.value = true;
}

async function readFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  importText.value = await file.text();
  previewImport();
}

async function previewImport() {
  if (!importText.value.trim()) return showToast('请先选择 .ics 文件或粘贴内容');
  importing.value = true;
  try {
    importPreview.value = await api.post('/calendar/import.ics', {
      class_id: importClassId.value,
      text: importText.value,
      dry_run: true,
    });
  } catch (e) {
    toastError(e);
    importPreview.value = null;
  } finally {
    importing.value = false;
  }
}

async function confirmImport() {
  importing.value = true;
  try {
    const d = await api.post('/calendar/import.ics', {
      class_id: importClassId.value,
      text: importText.value,
      dry_run: false,
    });
    showToast({ type: 'success', message: `已导入 ${d.created.length} 节课` });
    showImport.value = false;
    router.push('/schedule');
  } catch (e) {
    toastError(e);
  } finally {
    importing.value = false;
  }
}

async function logout() {
  try {
    await showConfirmDialog({ title: '退出登录', message: '确定退出当前账号吗？' });
  } catch {
    return;
  }
  auth.logout();
  showToast('已退出');
  router.replace('/login');
}
</script>

<template>
  <div class="d-page">
    <div class="d-head">
      <div>
        <h1>我的</h1>
        <div class="sub">{{ auth.roleLabel }} · {{ auth.user?.phone }}</div>
      </div>
      <div class="d-head-actions">
        <button class="d-btn danger" @click="logout">退出登录</button>
      </div>
    </div>

    <div class="d-grid-2">
      <div class="d-col">
        <div class="d-card">
          <div class="d-card-title"><span>账号信息</span></div>
          <div class="d-rows">
            <div class="d-row">
              <div class="grow">
                <div class="title">{{ auth.user?.name }}</div>
                <div class="meta">手机号 {{ auth.user?.phone }}</div>
              </div>
              <span class="d-badge" :class="auth.isSuper ? 'danger' : auth.isAdmin ? 'warn' : auth.canTeach ? 'info' : 'ok'">
                {{ auth.roleLabel }}
              </span>
            </div>
            <div class="d-row">
              <div class="grow">
                <div class="title">身份权限</div>
                <div class="meta">
                  {{ auth.isAdmin ? '可管理用户、角色与权限，查看全部班级' : auth.canTeach ? '可创建班级、排课、签到与记录' : '可查看课表、签到、提交请假与预约' }}
                </div>
              </div>
            </div>
            <div v-if="auth.canTeach" class="d-row">
              <div class="grow">
                <div class="title">课酬设置</div>
                <div class="meta">在班级详情里可设置单节课酬，首页会统计本月课酬</div>
              </div>
              <button class="d-btn sm" @click="router.push('/classes')">去设置</button>
            </div>
          </div>
        </div>

        <div class="d-card">
          <div class="d-card-title">
            <span>手机日历订阅</span>
            <span class="d-badge ok">自动同步</span>
          </div>
          <p style="font-size: 13px; line-height: 1.75; color: #4a5470; margin: 0 0 12px">
            把下面的地址加进手机自带日历（iOS/Android 都支持），之后课表有变动会自动同步，
            每节课还会提前 30 分钟提醒。
          </p>
          <div class="d-field" style="margin-bottom: 12px">
            <label>订阅地址（webcal）</label>
            <input class="d-input" :value="webcalUrl" readonly @focus="$event.target.select()" />
          </div>
          <div class="d-inline">
            <button class="d-btn primary" @click="copyFeed">复制订阅地址</button>
            <a class="d-btn" :href="webcalUrl">在日历中打开</a>
            <button class="d-btn" :disabled="exporting" @click="exportIcs">导出 .ics 文件</button>
            <button v-if="auth.canTeach" class="d-btn" @click="openImport">导入 .ics 排课</button>
            <button class="d-btn danger" @click="resetFeed">重置地址</button>
          </div>
          <p class="meta" style="font-size: 12px; color: #98a1b5; margin: 12px 0 0">
            订阅地址里带有一串专属令牌，请勿分享给他人；若泄露可点「重置地址」。
          </p>
        </div>
      </div>

      <div class="d-col">
        <div class="d-card">
          <div class="d-card-title"><span>手机日历怎么订阅</span></div>
          <div class="d-list-hint">
            <p><b>iPhone：</b>设置 → 日历 → 账户 → 添加账户 → 其他 → 添加已订阅的日历，把 webcal 地址粘进去。</p>
            <p><b>Android：</b>把上面的 <code>webcal://</code> 换成 <code>https://</code> 后在浏览器打开，会提示用日历应用打开，按提示添加即可。</p>
            <p><b>只想加几节课：</b>点「导出 .ics 文件」，用手机打开这个文件，选择把日程加入日历。</p>
            <p class="muted">取消订阅：在日历应用的账户/订阅列表里删掉即可。</p>
          </div>
        </div>

        <div class="d-card">
          <div class="d-card-title"><span>快捷入口</span></div>
          <div class="d-rows">
            <div class="d-row" style="cursor: pointer" @click="router.push('/requests')">
              <div class="grow">
                <div class="title">请假与预约</div>
                <div class="meta">提交申请、查看审批进度</div>
              </div>
              <van-icon name="arrow" color="#c3c9d6" />
            </div>
            <div class="d-row" style="cursor: pointer" @click="router.push('/availability')">
              <div class="grow">
                <div class="title">可上课时段</div>
                <div class="meta">用于和老师协调排课时间</div>
              </div>
              <van-icon name="arrow" color="#c3c9d6" />
            </div>
            <div v-if="auth.isAdmin" class="d-row" style="cursor: pointer" @click="router.push('/admin')">
              <div class="grow">
                <div class="title">管理后台</div>
                <div class="meta">用户、角色与权限</div>
              </div>
              <van-icon name="arrow" color="#c3c9d6" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <Modal v-model:show="showImport" title="从 .ics 导入排课" sub="支持手机日历导出的 .ics 文件" wide @update:show="showImport = $event">
      <div class="d-form" style="grid-template-columns: 1fr 1fr; margin-bottom: 14px">
        <div class="d-field">
          <label>导入到哪个班级 *</label>
          <select v-model.number="importClassId" class="d-select">
            <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="d-field">
          <label>选择文件</label>
          <input type="file" accept=".ics,text/calendar" class="d-input" @change="readFile" />
        </div>
      </div>
      <div class="d-field" style="margin-bottom: 14px">
        <label>或直接粘贴 .ics 内容</label>
        <textarea v-model="importText" class="d-textarea" style="min-height: 110px; font-family: monospace; font-size: 12px" placeholder="BEGIN:VCALENDAR ..." />
      </div>
      <div class="d-inline" style="margin-bottom: 12px">
        <button class="d-btn" :disabled="importing" @click="previewImport">生成预览</button>
        <span v-if="importPreview" class="d-badge info">共 {{ importPreview.summary.total }} 条</span>
        <span v-if="importPreview" class="d-badge ok">可导入 {{ importPreview.summary.ok }}</span>
        <span v-if="importPreview?.summary.conflict" class="d-badge warn">冲突 {{ importPreview.summary.conflict }}</span>
      </div>
      <div v-if="importPreview" class="d-scroll" style="max-height: 260px">
        <table class="d-table">
          <thead>
            <tr><th>日期</th><th>时间</th><th>主题</th><th>教室</th><th>结果</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in importPreview.plan" :key="`${p.date}${p.start_time}`">
              <td>{{ p.date }}</td>
              <td>{{ p.start_time }}</td>
              <td>{{ p.topic || '—' }}</td>
              <td>{{ p.room || '—' }}</td>
              <td>
                <span class="d-badge" :class="p.status === 'ok' ? 'ok' : p.status === 'conflict' ? 'warn' : 'mute'">
                  {{ p.status === 'ok' ? '可导入' : p.status === 'conflict' ? '冲突' : '跳过' }}
                </span>
                <span v-if="p.reason" style="font-size: 12px; color: #98a1b5; margin-left: 6px">{{ p.reason }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <button class="d-btn" @click="showImport = false">取消</button>
        <button class="d-btn primary" :disabled="importing || !importPreview?.summary.ok" @click="confirmImport">
          导入 {{ importPreview?.summary.ok || 0 }} 节课
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.d-list-hint p { font-size: 13px; line-height: 1.8; color: #4a5470; margin: 0 0 10px; }
.d-list-hint p:last-child { margin-bottom: 0; }
.d-list-hint code { background: #f2f4fa; padding: 1px 5px; border-radius: 5px; font-size: 12px; }
</style>
