<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import Modal from '../../ui/Modal.vue';
import PhotoField from '../../components/PhotoField.vue';
import { addDays, endTime, fmtDate, LESSON_STATUS, BADGE } from '../../utils';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const classId = Number(route.params.id);
const todayStr = fmtDate(new Date());

const info = ref(null);
const stats = ref(null);
const lessons = ref([]);
const loading = ref(true);
const exporting = ref(false);

const showStudent = ref(false);
const student = ref({ name: '', phone: '', remark: '' });
const showBulk = ref(false);
const bulk = ref({ from: todayStr, to: addDays(todayStr, 7), status: 'canceled' });
const showSettings = ref(false);
const settings = ref({ name: '', subject: '', description: '', rate: 0 });
const busy = ref(false);

/* 收费结算（按学生月度统计） */
const billMonth = ref(todayStr.slice(0, 7));
const billing = ref(null);
const billingLoading = ref(false);

function monthRange(m) {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, '0')}`];
}

async function loadBilling() {
  billingLoading.value = true;
  try {
    const [from, to] = monthRange(billMonth.value);
    billing.value = await api.get(`/classes/${classId}/billing`, { params: { from, to } });
  } catch (e) {
    toastError(e);
    billing.value = null;
  } finally {
    billingLoading.value = false;
  }
}

async function exportBilling() {
  try {
    const [from, to] = monthRange(billMonth.value);
    const blob = await api.get(`/classes/${classId}/billing/export`, { params: { from, to }, responseType: 'blob' });
    saveBlob(blob, `${info.value.class.name}-收费结算-${billMonth.value}.csv`);
    showToast({ type: 'success', message: '结算单已导出' });
  } catch (e) {
    toastError(e);
  }
}

async function load() {
  loading.value = true;
  try {
    info.value = await api.get(`/classes/${classId}`);
    const d = await api.get('/lessons', { params: { from: addDays(todayStr, -30), to: addDays(todayStr, 60), class_id: classId } });
    lessons.value = d.lessons;
    if (auth.canTeach || auth.isAdmin) {
      stats.value = await api.get(`/classes/${classId}/stats`);
      loadBilling();
    }
    settings.value = {
      name: info.value.class.name,
      subject: info.value.class.subject,
      description: info.value.class.description,
      rate: info.value.class.rate,
    };
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function copyCode() {
  // 老师实际是在微信里发链接，学生打开注册页自动带码进班
  const link = `${location.origin}/register?invite=${info.value.class.invite_code}`;
  try {
    await navigator.clipboard.writeText(`邀请你加入「${info.value.class.name}」，注册后自动进班：${link}`);
    showToast({ type: 'success', message: '邀请链接已复制，发给学生即可' });
  } catch {
    showToast(`邀请码：${info.value.class.invite_code}`);
  }
}

async function addStudent() {
  if (!student.value.name.trim()) return showToast('请填写学生姓名');
  busy.value = true;
  try {
    await api.post(`/classes/${classId}/students`, student.value);
    showToast({ type: 'success', message: '已添加' });
    showStudent.value = false;
    student.value = { name: '', phone: '', remark: '' };
    load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function removeStudent(s) {
  try {
    await showConfirmDialog({ title: '移除学生', message: `确定将「${s.name}」移出班级吗？`, confirmButtonText: '移除' });
  } catch {
    return;
  }
  try {
    await api.delete(`/classes/${classId}/students/${s.id}`);
    showToast('已移除');
    load();
  } catch (e) {
    toastError(e);
  }
}

async function saveSettings() {
  busy.value = true;
  try {
    await api.put(`/classes/${classId}`, settings.value);
    showToast({ type: 'success', message: '已保存' });
    showSettings.value = false;
    load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function runBulk() {
  busy.value = true;
  try {
    const d = await api.post('/lessons/bulk-status', { class_id: classId, ...bulk.value });
    showToast({ type: 'success', message: d.updated ? `已更新 ${d.updated} 节课` : '这段时间没有需要变更的课时' });
    showBulk.value = false;
    load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function downloadCsv() {
  exporting.value = true;
  try {
    const blob = await api.get('/lessons/export/csv', { params: { class_id: classId }, responseType: 'blob' });
    saveBlob(blob, `${info.value.class.name}-课时签到记录.csv`);
    showToast({ type: 'success', message: '已导出 CSV' });
  } catch (e) {
    toastError(e);
  } finally {
    exporting.value = false;
  }
}

async function downloadIcs() {
  try {
    const blob = await api.get('/calendar/export.ics', { params: { class_id: classId }, responseType: 'blob' });
    saveBlob(blob, `${info.value.class.name}-课表.ics`);
    showToast({ type: 'success', message: '已导出 .ics' });
  } catch (e) {
    toastError(e);
  }
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const upcoming = computed(() => lessons.value.filter((l) => l.date >= todayStr).slice(0, 10));
const happened = computed(() => lessons.value.filter((l) => l.date < todayStr).reverse().slice(0, 10));

function statusOf(l) {
  return LESSON_STATUS[l.status] || LESSON_STATUS.scheduled;
}
</script>

<template>
  <div class="d-page">
    <div v-if="loading" class="d-empty">加载中…</div>
    <template v-else-if="info">
      <div class="d-head">
        <div>
          <h1>
            <span class="d-dot" :style="{ background: info.class.color, width: '12px', height: '12px', marginRight: '10px' }" />
            {{ info.class.name }}
          </h1>
          <div class="sub">
            <template v-if="info.class.subject">{{ info.class.subject }} · </template>
            学生 {{ info.students.length }} 人
            <template v-if="info.class.description"> · {{ info.class.description }}</template>
          </div>
        </div>
        <div class="d-head-actions">
          <button class="d-btn" @click="router.push('/schedule')">查看课表</button>
          <button v-if="auth.canTeach" class="d-btn" @click="showSettings = true">班级设置</button>
          <button v-if="auth.canTeach" class="d-btn" @click="showBulk = true">批量停课 / 复课</button>
          <button v-if="auth.canTeach" class="d-btn" :disabled="exporting" @click="downloadCsv">导出签到 CSV</button>
          <button class="d-btn" @click="downloadIcs">导出课表 .ics</button>
        </div>
      </div>

      <div class="d-split">
        <div class="d-col">
          <div class="d-card">
            <div class="d-card-title">
              <span>学生名单</span>
              <button v-if="auth.canTeach" class="d-btn sm" @click="showStudent = true">添加学生</button>
            </div>
            <div v-if="!info.students.length" class="d-empty">
              <strong>还没有学生</strong>
              可以手动添加，也可以把邀请码发给学生让他们自己加入
            </div>
            <div v-else class="d-scroll">
              <table class="d-table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>手机号</th>
                    <th>备注</th>
                    <th class="center">账号</th>
                    <th v-if="auth.canTeach" class="actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in info.students" :key="s.id">
                    <td class="strong">{{ s.name }}</td>
                    <td>{{ s.phone || '—' }}</td>
                    <td>{{ s.remark || '—' }}</td>
                    <td class="center">
                      <span class="d-badge" :class="s.user_id ? 'ok' : 'mute'">{{ s.user_id ? '已绑定' : '未绑定' }}</span>
                    </td>
                    <td v-if="auth.canTeach" class="actions">
                      <button class="d-btn sm danger" @click="removeStudent(s)">移除</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="stats" class="d-card">
            <div class="d-card-title">
              <span>出勤统计</span>
              <span class="d-badge mute">按已记录的 {{ stats.total_lessons }} 节课</span>
            </div>            <div class="d-scroll">
              <table class="d-table">
                <thead>
                  <tr>
                    <th>学生</th>
                    <th class="center">出勤</th>
                    <th class="center">迟到</th>
                    <th class="center">缺勤</th>
                    <th class="center">请假</th>
                    <th class="center">已签名</th>
                    <th style="min-width: 170px">出勤率</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in stats.stats" :key="s.id">
                    <td class="strong">{{ s.name }}</td>
                    <td class="center">{{ s.present }}</td>
                    <td class="center">{{ s.late }}</td>
                    <td class="center">{{ s.absent }}</td>
                    <td class="center">{{ s.leave }}</td>
                    <td class="center">{{ s.signed }}</td>
                    <td>
                      <div v-if="s.rate != null" class="rate-bar">
                        <div class="rate-track">
                          <div class="rate-fill" :style="{ width: `${s.rate}%`, background: s.rate >= 80 ? '#07c160' : s.rate >= 60 ? '#ff976a' : '#ee0a24' }" />
                        </div>
                        <span>{{ s.rate }}%</span>
                      </div>
                      <span v-else style="color: #b6bdcc; font-size: 12.5px">暂无记录</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>


          <div v-if="billing" class="d-card">
            <div class="d-card-title">
              <span>收费结算</span>
              <div class="d-inline" style="gap: 8px">
                <input v-model="billMonth" type="month" class="d-input" style="width: 150px" @change="loadBilling" />
                <button class="d-btn sm" :disabled="billingLoading" @click="loadBilling">刷新</button>
                <button class="d-btn sm primary" @click="exportBilling">导出结算单 CSV</button>
              </div>
            </div>
            <div class="d-toolbar" style="margin-bottom: 10px">
              <span class="d-badge info">{{ billing.range[0] }} 至 {{ billing.range[1] }}</span>
              <span class="d-badge mute">课次 {{ billing.lesson_count }}（已完成 {{ billing.done_lesson_count }}）</span>
              <span class="d-badge ok">合计应收 {{ billing.total_amount }} 元</span>
              <span v-if="!billing.class.rate" class="d-badge warn">未设置单节课酬，先在「班级设置」里填写</span>
            </div>
            <div v-if="!billing.stats.length" class="d-empty"><strong>班级还没有学生</strong></div>
            <div v-else class="d-scroll">
              <table class="d-table">
                <thead>
                  <tr>
                    <th>学生</th>
                    <th class="center">时段课次</th>
                    <th class="center">出勤</th>
                    <th class="center">请假</th>
                    <th class="center">缺勤</th>
                    <th class="center">未记录</th>
                    <th class="num">应收金额</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in billing.stats" :key="s.id">
                    <td class="strong">{{ s.name }}<span v-if="s.remark" style="color: #98a1b5; font-weight: 400">（{{ s.remark }}）</span></td>
                    <td class="center">{{ s.unmarked + s.marked }}</td>
                    <td class="center">{{ s.attended }}<span v-if="s.late" style="color: #ff976a">（含迟到 {{ s.late }}）</span></td>
                    <td class="center">{{ s.leave }}</td>
                    <td class="center">{{ s.absent }}</td>
                    <td class="center">{{ s.unmarked }}</td>
                    <td class="num strong">{{ s.amount }} 元</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style="font-size: 12px; color: #98a1b5; margin-top: 10px">
              计费口径：出勤与迟到计费，请假与缺勤不计费；金额只按已记录的考勤统计。
            </div>
          </div>

          <div class="d-card">
            <div class="d-card-title"><span>近期课时</span><span class="d-badge mute">{{ lessons.length }} 节</span></div>
            <div class="d-toolbar" style="margin-bottom: 10px">
              <span class="d-badge info">即将上课 {{ upcoming.length }}</span>
              <span class="d-badge mute">已过去 {{ happened.length }}</span>
            </div>
            <div v-if="!lessons.length" class="d-empty"><strong>还没有排课</strong></div>
            <div v-else class="d-scroll" style="max-height: 420px">
              <table class="d-table">
                <thead>
                  <tr><th>日期</th><th>时间</th><th>教室</th><th>主题</th><th class="center">签到</th><th>状态</th><th class="actions">操作</th></tr>
                </thead>
                <tbody>
                  <tr v-for="l in lessons" :key="l.id">
                    <td class="strong">{{ l.date }}</td>
                    <td>{{ l.start_time }} - {{ endTime(l.start_time, l.duration_min) }}</td>
                    <td>{{ l.room || '—' }}</td>
                    <td>{{ l.topic || '—' }}</td>
                    <td class="center">{{ l.checked_count }}/{{ l.student_count }}</td>
                    <td><span class="d-badge" :class="BADGE[statusOf(l).color]">{{ statusOf(l).text }}</span></td>
                    <td class="actions">
                      <button class="d-btn sm" @click="router.push(`/lessons/${l.id}`)">详情</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="d-col">
          <div v-if="auth.canTeach" class="d-card">
            <div class="d-card-title">
              <span>班级邀请码</span>
              <button class="d-btn sm" @click="copyCode">复制</button>
            </div>
            <div style="font-family: monospace; font-size: 30px; font-weight: 700; letter-spacing: 7px; color: var(--van-primary-color); text-align: center; padding: 6px 0 10px">
              {{ info.class.invite_code }}
            </div>
            <div style="font-size: 12.5px; color: #98a1b5; text-align: center">
              复制链接发给学生，注册后自动加入本班
            </div>
          </div>

          <div class="d-card">
            <div class="d-card-title"><span>班级信息</span></div>
            <div class="d-rows">
              <div class="d-row"><div class="grow"><div class="meta">授课老师</div><div class="title">{{ info.teacher?.name || '—' }}</div></div></div>
              <div class="d-row"><div class="grow"><div class="meta">科目</div><div class="title">{{ info.class.subject || '—' }}</div></div></div>
              <div class="d-row"><div class="grow"><div class="meta">单节课酬</div><div class="title">{{ info.class.rate ? `${info.class.rate} 元` : '未设置' }}</div></div></div>
              <div class="d-row"><div class="grow"><div class="meta">创建时间</div><div class="title">{{ info.class.created_at?.slice(0, 10) }}</div></div></div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <Modal v-model:show="showStudent" title="添加学生" sub="手动登记的学生不会收到通知，但可在签到名单里使用" @update:show="showStudent = $event">
      <div class="d-form two">
        <div class="d-field"><label>姓名 *</label><input v-model="student.name" class="d-input" /></div>
        <div class="d-field"><label>手机号</label><input v-model="student.phone" class="d-input" /></div>
        <div class="d-field" style="grid-column: 1 / -1"><label>备注</label><input v-model="student.remark" class="d-input" placeholder="选填" /></div>
      </div>
      <template #footer>
        <button class="d-btn" @click="showStudent = false">取消</button>
        <button class="d-btn primary" :disabled="busy" @click="addStudent">添加</button>
      </template>
    </Modal>

    <Modal v-model:show="showSettings" title="班级设置" @update:show="showSettings = $event">
      <div class="d-form two">
        <div class="d-field"><label>班级名称</label><input v-model="settings.name" class="d-input" /></div>
        <div class="d-field"><label>科目</label><input v-model="settings.subject" class="d-input" /></div>
        <div class="d-field"><label>单节课酬（元）</label><input v-model.number="settings.rate" type="number" min="0" class="d-input" /></div>
        <div class="d-field"><label>班级简介</label><input v-model="settings.description" class="d-input" /></div>
      </div>
      <template #footer>
        <button class="d-btn" @click="showSettings = false">取消</button>
        <button class="d-btn primary" :disabled="busy" @click="saveSettings">保存</button>
      </template>
    </Modal>

    <Modal v-model:show="showBulk" title="批量停课 / 复课" sub="放假、调休时一次处理整段课时" size="narrow" @update:show="showBulk = $event">
      <div class="d-form">
        <div class="d-field"><label>开始日期</label><input v-model="bulk.from" type="date" class="d-input" /></div>
        <div class="d-field"><label>结束日期</label><input v-model="bulk.to" type="date" class="d-input" /></div>
        <div class="d-field">
          <label>设为</label>
          <select v-model="bulk.status" class="d-select">
            <option value="canceled">已取消（停课）</option>
            <option value="scheduled">待上课（恢复）</option>
          </select>
        </div>
      </div>
      <div class="d-badge warn" style="margin-top: 14px; display: block; padding: 10px 12px">
        会修改这段时间内该班级的全部课时状态，签到与留痕不受影响
      </div>
      <template #footer>
        <button class="d-btn" @click="showBulk = false">取消</button>
        <button class="d-btn primary" :disabled="busy" @click="runBulk">执行</button>
      </template>
    </Modal>
  </div>
</template>
