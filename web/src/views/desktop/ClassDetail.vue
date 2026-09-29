<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import Modal from '../../ui/Modal.vue';
import PhotoField from '../../components/PhotoField.vue';
import ChangeLogList from '../../components/ChangeLogList.vue';
import { addDays, endTime, fmtDate, LESSON_STATUS, BADGE } from '../../utils';
import { useBack } from '../../composables/back';

const route = useRoute();
const router = useRouter();
const back = useBack('/classes');
const auth = useAuthStore();
const classId = Number(route.params.id);
const todayStr = fmtDate(new Date());

const info = ref(null);
const stats = ref(null);
const lessons = ref([]);
const loading = ref(true);
const exporting = ref(false);

const showStudent = ref(false);
const student = ref({ name: '', phone: '', guardian_phone: '', remark: '', lessons_total: 0, lessons_bonus: 0 });
const showBulk = ref(false);
const bulk = ref({ from: todayStr, to: addDays(todayStr, 7), status: 'canceled', only_holidays: false });
const showSettings = ref(false);
const settings = ref({ name: '', subject: '', description: '', rate: 0 });
const busy = ref(false);

/** 调课 / 停课留痕（按需加载，不拖慢首屏） */
const changes = ref([]);
const loadingChanges = ref(false);

async function loadChanges() {
  loadingChanges.value = true;
  try {
    const d = await api.get('/lessons/changes', { params: { class_id: classId, limit: 30 } });
    changes.value = d.changes;
  } catch (e) {
    toastError(e);
  } finally {
    loadingChanges.value = false;
  }
}

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

/** 编辑学生资料与课时包 */
const showStudentEdit = ref(false);
const editTarget = ref(null);
const editForm = ref({ name: '', phone: '', guardian_phone: '', remark: '', lessons_total: 0, lessons_bonus: 0 });

function openStudentEdit(s) {
  editTarget.value = s;
  editForm.value = {
    name: s.name,
    phone: s.phone || '',
    guardian_phone: s.guardian_phone || '',
    remark: s.remark || '',
    lessons_total: s.credits.lessons_total,
    lessons_bonus: s.credits.lessons_bonus,
  };
  showStudentEdit.value = true;
}

async function saveStudentEdit() {
  if (!editForm.value.name.trim()) return showToast('请填写学生姓名');
  busy.value = true;
  try {
    await api.put(`/classes/${classId}/students/${editTarget.value.id}`, editForm.value);
    showToast({ type: 'success', message: '已保存' });
    showStudentEdit.value = false;
    await load();
    if (makeups.value) loadMakeups();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

/* ---------------- 待补课台账 ---------------- */
const makeups = ref(null);
const loadingMakeups = ref(false);

async function loadMakeups() {
  loadingMakeups.value = true;
  try {
    const d = await api.get('/lessons/makeups', { params: { class_id: classId, limit: 60 } });
    makeups.value = d.makeups;
  } catch (e) {
    toastError(e);
  } finally {
    loadingMakeups.value = false;
  }
}

async function settleMakeup(m, status) {
  try {
    await api.put(`/lessons/makeups/${m.id}`, { status });
    showToast({ type: 'success', message: status === 'done' ? '已记为补课完成' : '已标记免补' });
    await loadMakeups();
    load();
  } catch (e) {
    toastError(e);
  }
}

/** 批量调课：整段顺延或统一改时间 */
const batchMode = ref('status');
const batchShift = ref(7);
const batchTime = ref('19:00');
const batchPreview = ref(null);

async function previewBatch() {
  busy.value = true;
  try {
    const body = { class_id: classId, from: bulk.value.from, to: bulk.value.to, dry_run: true };
    if (batchMode.value === 'shift') body.shift_days = Number(batchShift.value);
    else if (batchMode.value === 'time') body.start_time = batchTime.value;
    else return;
    batchPreview.value = await api.post('/lessons/batch-reschedule', body);
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function runBatchReschedule() {
  busy.value = true;
  try {
    const body = { class_id: classId, from: bulk.value.from, to: bulk.value.to, dry_run: false };
    if (batchMode.value === 'shift') body.shift_days = Number(batchShift.value);
    else body.start_time = batchTime.value;
    const d = await api.post('/lessons/batch-reschedule', body);
    showToast({ type: 'success', message: `已调整 ${d.updated} 节课` });
    showBulk.value = false;
    batchPreview.value = null;
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
    if (!d.updated) {
      showToast(bulk.value.only_holidays ? '这段时间没有落在法定节假日的课时' : '这段时间没有需要变更的课时');
    } else if (bulk.value.only_holidays && d.holidays?.length) {
      showToast({ type: 'success', message: `已处理 ${d.updated} 节课（${d.holidays.join('、')}）` });
    } else {
      showToast({ type: 'success', message: `已更新 ${d.updated} 节课` });
    }
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
          <button class="d-back" @click="back()">
            <van-icon name="arrow-left" /> 返回班级列表
          </button>
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
          <button v-if="auth.canTeach" class="d-btn" @click="showBulk = true">批量调整课时</button>
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
                    <th>家长电话</th>
                    <th class="center">课时余额</th>
                    <th class="center">待补课</th>
                    <th class="center">账号</th>
                    <th v-if="auth.canTeach" class="actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in info.students" :key="s.id">
                    <td class="strong">{{ s.name }}</td>
                    <td>{{ s.phone || '—' }}</td>
                    <td>{{ s.guardian_phone || '—' }}</td>
                    <td class="center">
                      <span v-if="!s.credits.lessons_total" class="d-badge mute">未购课时</span>
                      <span v-else class="d-badge" :class="s.credits.owed ? 'danger' : s.credits.low ? 'warn' : 'ok'">
                        {{ s.credits.remaining }} / {{ s.credits.lessons_total + s.credits.lessons_bonus }}
                      </span>
                    </td>
                    <td class="center">
                      <span v-if="s.owed_makeups" class="d-badge warn">{{ s.owed_makeups }} 节</span>
                      <span v-else class="d-badge mute">—</span>
                    </td>
                    <td class="center">
                      <span class="d-badge" :class="s.user_id ? 'ok' : 'mute'">{{ s.user_id ? '已绑定' : '未绑定' }}</span>
                    </td>
                    <td v-if="auth.canTeach" class="actions">
                      <button class="d-btn sm" @click="openStudentEdit(s)">课时/资料</button>
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
            <div class="d-card-title">
              <span>调课记录</span>
              <button class="d-btn sm" :disabled="loadingChanges" @click="loadChanges">
                {{ changes.length ? '刷新' : '查看' }}
              </button>
            </div>
            <ChangeLogList :changes="changes" />
          </div>

          <div class="d-card">
            <div class="d-card-title">
              <span>待补课</span>
              <span v-if="makeups" class="d-badge" :class="makeups.length ? 'warn' : 'mute'">{{ makeups.length }} 条</span>
              <button class="d-btn sm" :disabled="loadingMakeups" @click="loadMakeups">
                {{ makeups ? '刷新' : '查看' }}
              </button>
            </div>
            <div v-if="!makeups" class="d-empty" style="padding: 20px 10px">
              <strong>点「查看」加载</strong>
              学生请假后会自动记一笔待补课
            </div>
            <div v-else-if="!makeups.length" class="d-empty" style="padding: 20px 10px">
              <strong>没有欠课</strong>
              大家都不欠课，挺好
            </div>
            <div v-else class="d-rows">
              <div v-for="m in makeups" :key="m.id" class="d-row">
                <div class="grow">
                  <div class="title">
                    {{ m.student_name }}
                    <span class="d-badge" :class="m.status === 'pending' ? 'warn' : m.status === 'done' ? 'ok' : 'mute'" style="margin-left: 6px">
                      {{ { pending: '待补', scheduled: '已约', done: '已补', waived: '免补' }[m.status] }}
                    </span>
                  </div>
                  <div class="meta">
                    缺 {{ m.missed_date }} {{ m.missed_start_time || '' }}
                    <template v-if="m.makeup_date"> · 补于 {{ m.makeup_date }} {{ m.makeup_start_time || '' }}</template>
                    <template v-if="m.note"> · {{ m.note }}</template>
                  </div>
                </div>
                <button v-if="m.status !== 'done'" class="d-btn sm primary" @click="settleMakeup(m, 'done')">已补</button>
                <button v-if="m.status === 'pending'" class="d-btn sm" @click="settleMakeup(m, 'waived')">免补</button>
              </div>
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
        <div class="d-field"><label>家长电话</label><input v-model="student.guardian_phone" class="d-input" /></div>
        <div class="d-field"><label>购买课时数</label><input v-model.number="student.lessons_total" type="number" min="0" class="d-input" placeholder="0 = 未购买课时包" /></div>
        <div class="d-field"><label>赠送课时数</label><input v-model.number="student.lessons_bonus" type="number" min="0" class="d-input" /></div>
        <div class="d-field" style="grid-column: 1 / -1"><label>备注</label><input v-model="student.remark" class="d-input" placeholder="选填" /></div>
      </div>
      <template #footer>
        <button class="d-btn" @click="showStudent = false">取消</button>
        <button class="d-btn primary" :disabled="busy" @click="addStudent">添加</button>
      </template>
    </Modal>

    <Modal
      v-model:show="showStudentEdit"
      :title="editTarget ? `课时与资料 · ${editTarget.name}` : '课时与资料'"
      sub="「已消课时」= 已完成课时里的出勤/迟到/缺勤；请假不扣课时，改为计入待补课"
      @update:show="showStudentEdit = $event"
    >
      <div class="d-form two">
        <div class="d-field"><label>姓名 *</label><input v-model="editForm.name" class="d-input" /></div>
        <div class="d-field"><label>手机号</label><input v-model="editForm.phone" class="d-input" /></div>
        <div class="d-field"><label>家长电话</label><input v-model="editForm.guardian_phone" class="d-input" /></div>
        <div class="d-field"><label>备注</label><input v-model="editForm.remark" class="d-input" /></div>
        <div class="d-field"><label>购买课时数</label><input v-model.number="editForm.lessons_total" type="number" min="0" class="d-input" /></div>
        <div class="d-field"><label>赠送课时数</label><input v-model.number="editForm.lessons_bonus" type="number" min="0" class="d-input" /></div>
      </div>
      <div v-if="editTarget" class="d-inline" style="margin-top: 14px">
        <span class="d-badge" :class="editTarget.credits.owed ? 'danger' : editTarget.credits.low ? 'warn' : 'ok'">
          当前剩余 {{ editTarget.credits.remaining }} 节
        </span>
        <span class="d-badge mute">已消 {{ editTarget.credits.used }} 节</span>
        <span v-if="editTarget.owed_makeups" class="d-badge warn">待补课 {{ editTarget.owed_makeups }} 节</span>
      </div>
      <template #footer>
        <button class="d-btn" @click="showStudentEdit = false">取消</button>
        <button class="d-btn primary" :disabled="busy" @click="saveStudentEdit">保存</button>
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

    <Modal
      v-model:show="showBulk"
      title="批量调整课时"
      sub="放假停课、整段顺延、统一改时间，都在这里一次处理"
      @update:show="showBulk = $event; batchPreview = null"
    >
      <div class="seg-toggle" style="margin-bottom: 14px">
        <button :class="{ on: batchMode === 'status' }" @click="batchMode = 'status'; batchPreview = null">停课 / 复课</button>
        <button :class="{ on: batchMode === 'shift' }" @click="batchMode = 'shift'; batchPreview = null">整段顺延</button>
        <button :class="{ on: batchMode === 'time' }" @click="batchMode = 'time'; batchPreview = null">统一改时间</button>
      </div>

      <div class="d-form two">
        <div class="d-field"><label>开始日期</label><input v-model="bulk.from" type="date" class="d-input" /></div>
        <div class="d-field"><label>结束日期</label><input v-model="bulk.to" type="date" class="d-input" /></div>

        <template v-if="batchMode === 'status'">
          <div class="d-field">
            <label>设为</label>
            <select v-model="bulk.status" class="d-select">
              <option value="canceled">已取消（停课）</option>
              <option value="scheduled">待上课（恢复）</option>
            </select>
          </div>
          <div class="d-field" style="justify-content: flex-end">
            <label class="d-check">
              <input v-model="bulk.only_holidays" type="checkbox" />
              只处理法定节假日的课时
            </label>
          </div>
        </template>

        <template v-else-if="batchMode === 'shift'">
          <div class="d-field">
            <label>顺延天数（负数为提前）</label>
            <input v-model.number="batchShift" type="number" min="-60" max="60" class="d-input" />
          </div>
        </template>

        <template v-else>
          <div class="d-field">
            <label>统一改为几点开始</label>
            <input v-model="batchTime" type="time" class="d-input" />
          </div>
        </template>
      </div>

      <div v-if="batchPreview" style="margin-top: 14px">
        <div class="d-inline" style="margin-bottom: 8px">
          <span class="d-badge info">共 {{ batchPreview.summary.total }} 节</span>
          <span class="d-badge ok">可调整 {{ batchPreview.summary.ok }}</span>
          <span v-if="batchPreview.summary.conflict" class="d-badge warn">冲突 {{ batchPreview.summary.conflict }}</span>
        </div>
        <div class="d-scroll" style="max-height: 220px">
          <table class="d-table">
            <thead><tr><th>原时间</th><th>调整后</th><th>结果</th></tr></thead>
            <tbody>
              <tr v-for="p in batchPreview.plan" :key="p.id">
                <td>{{ p.from.date }} {{ p.from.start_time }}</td>
                <td class="strong">{{ p.to.date }} {{ p.to.start_time }}</td>
                <td>
                  <span class="d-badge" :class="p.status === 'ok' ? 'ok' : 'warn'">
                    {{ p.status === 'ok' ? '可调整' : p.reason }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="muted" style="font-size: 12.5px; margin-top: 8px">
          冲突的课会被跳过，不影响其他课时
        </div>
      </div>

      <div v-else class="d-badge warn" style="margin-top: 14px; display: block; padding: 10px 12px">
        <template v-if="batchMode === 'status'">
          {{ bulk.only_holidays
            ? '只修改日期属于国家法定节假日的课时（调休补班日不算），其他课时不受影响'
            : '会修改这段时间内该班级的全部课时状态，签到与留痕不受影响' }}
        </template>
        <template v-else-if="batchMode === 'shift'">
          这段时间内的课整体平移 {{ batchShift }} 天；学生与家长会收到通知
        </template>
        <template v-else>
          这段时间内的课统一改到 {{ batchTime }} 开始；学生与家长会收到通知
        </template>
      </div>

      <template #footer>
        <button class="d-btn" @click="showBulk = false">取消</button>
        <template v-if="batchMode === 'status'">
          <button class="d-btn primary" :disabled="busy" @click="runBulk">执行</button>
        </template>
        <template v-else>
          <button class="d-btn" :disabled="busy" @click="previewBatch">预览</button>
          <button class="d-btn primary" :disabled="busy || !batchPreview || !batchPreview.summary.ok" @click="runBatchReschedule">
            确认调整 {{ batchPreview ? batchPreview.summary.ok : 0 }} 节
          </button>
        </template>
      </template>
    </Modal>
  </div>
</template>
