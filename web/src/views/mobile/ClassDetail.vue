<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { isDesktop } from '../../composables/layout';
import { useBack } from '../../composables/back';
import { addDays, fmtDate } from '../../utils';
import LessonCard from '../../components/LessonCard.vue';
import ChangeLogList from '../../components/ChangeLogList.vue';

const route = useRoute();
const router = useRouter();
const back = useBack('/classes');
const auth = useAuthStore();
const classId = Number(route.params.id);

const info = ref(null);
const upcoming = ref([]);
const stats = ref(null);
const loading = ref(true);
const exporting = ref(false);

/** 调课 / 停课留痕（按需加载） */
const changes = ref([]);

async function loadChanges() {
  try {
    const d = await api.get('/lessons/changes', { params: { class_id: classId, limit: 30 } });
    changes.value = d.changes;
  } catch (e) {
    toastError(e);
  }
}

/* ---------------- 课时包与待补课 ---------------- */
const showEdit = ref(false);
const editTarget = ref(null);
const savingEdit = ref(false);
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
  showEdit.value = true;
}

async function saveStudentEdit() {
  if (!editForm.value.name.trim()) return showToast('请填写学生姓名');
  savingEdit.value = true;
  try {
    await api.put(`/classes/${classId}/students/${editTarget.value.id}`, editForm.value);
    showToast({ type: 'success', message: '已保存' });
    showEdit.value = false;
    await load();
    if (makeups.value) loadMakeups();
  } catch (e) {
    toastError(e);
  } finally {
    savingEdit.value = false;
  }
}

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

/* 收费结算（按学生月度统计） */
const billMonth = ref(fmtDate(new Date()).slice(0, 7));
const billing = ref(null);

function monthRange(m) {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, '0')}`];
}

async function loadBilling() {
  try {
    const [from, to] = monthRange(billMonth.value);
    billing.value = await api.get(`/classes/${classId}/billing`, { params: { from, to } });
  } catch (e) {
    billing.value = null;
  }
}

async function exportBilling() {
  try {
    const [from, to] = monthRange(billMonth.value);
    const blob = await api.get(`/classes/${classId}/billing/export`, { params: { from, to }, responseType: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${info.value.class.name}-收费结算-${billMonth.value}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast({ type: 'success', message: '结算单已导出' });
  } catch (e) {
    toastError(e);
  }
}

async function load() {
  loading.value = true;
  try {
    info.value = await api.get(`/classes/${classId}`);
    const from = fmtDate(new Date());
    const d = await api.get('/lessons', { params: { from, to: addDays(from, 60), class_id: classId } });
    upcoming.value = d.lessons.slice(0, isDesktop.value ? 8 : 5);
    if (auth.canTeach) {
      stats.value = await api.get(`/classes/${classId}/stats`);
      loadBilling();
    }
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

/** 导出本节课表与签到明细为 CSV（Excel 可直接打开） */
async function exportCsv() {
  exporting.value = true;
  try {
    const blob = await api.get('/lessons/export/csv', {
      params: { class_id: classId },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${info.value.class.name}-课时签到记录.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast({ type: 'success', message: '已导出 CSV' });
  } catch (e) {
    toastError(e);
  } finally {
    exporting.value = false;
  }
}

async function copyCode() {
  // 微信里发链接，学生打开注册页自动带码进班
  const link = `${location.origin}/register?invite=${info.value.class.invite_code}`;
  try {
    await navigator.clipboard.writeText(`邀请你加入「${info.value.class.name}」，注册后自动进班：${link}`);
    showToast({ type: 'success', message: '邀请链接已复制，发给学生即可' });
  } catch {
    showToast(`邀请码：${info.value.class.invite_code}`);
  }
}

/* 学生管理（教师） */
const showAdd = ref(false);
const form = ref({ name: '', phone: '', guardian_phone: '', remark: '', lessons_total: 0, lessons_bonus: 0 });
const saving = ref(false);

async function addStudent() {
  if (!form.value.name.trim()) return showToast('请填写学生姓名');
  saving.value = true;
  try {
    await api.post(`/classes/${classId}/students`, form.value);
    showToast({ type: 'success', message: '已添加' });
    showAdd.value = false;
    form.value = { name: '', phone: '', remark: '' };
    load();
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}

async function removeStudent(s) {
  try {
    await showConfirmDialog({ title: '移除学生', message: `确定将「${s.name}」移出班级吗？` });
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

const subjectTag = computed(() => info.value?.class?.subject || '课程');
</script>

<template>
  <div class="page">
    <van-nav-bar title="班级详情" left-arrow @click-left="back()" />

    <van-loading v-if="loading" style="margin: 30px auto" vertical>加载中…</van-loading>
    <template v-else-if="info">
      <div class="split">
        <div class="col">
          <div class="card" style="display: flex; gap: 12px; align-items: center">
            <div class="class-chip" :style="{ background: info.class.color }">{{ info.class.name.slice(0, 1) }}</div>
            <div style="flex: 1; min-width: 0">
              <div class="class-name">{{ info.class.name }}</div>
              <div class="class-info">
                <van-tag plain type="primary">{{ subjectTag }}</van-tag>
                <span>学生 {{ info.students.length }} 人</span>
              </div>
            </div>
          </div>
          <div v-if="info.class.description" class="card muted">{{ info.class.description }}</div>

          <div v-if="auth.canTeach" class="card">
            <div style="display: flex; align-items: center; justify-content: space-between">
              <span style="font-size: 14px; font-weight: 600">班级邀请码</span>
              <van-tag plain type="primary" style="cursor: pointer" @click="copyCode">点击复制</van-tag>
            </div>
            <div class="invite-code">{{ info.class.invite_code }}</div>
            <div class="muted" style="text-align: center">复制链接发给学生，注册后自动加入本班</div>
          </div>

          <div v-if="auth.canTeach" class="card">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px">
              <div>
                <div style="font-size: 14px; font-weight: 600">课时记录导出</div>
                <div class="muted" style="margin-top: 4px">含日期、时长、签到人数与课堂记录，可用 Excel 打开</div>
              </div>
              <van-button size="small" round type="primary" plain icon="down" :loading="exporting" @click="exportCsv">
                导出 CSV
              </van-button>
            </div>
          </div>
        </div>

        <div class="col">
          <div class="section-head" style="margin-top: 0">
            <span>学生名单</span>
            <van-tag v-if="auth.canTeach" plain type="primary" style="cursor: pointer" @click="showAdd = true">+ 添加</van-tag>
          </div>
          <div class="card card-tight">
            <div v-for="s in info.students" :key="s.id" class="attend-row">
              <div class="attend-name">
                <span>{{ s.name }}</span>
                <van-tag v-if="s.phone" plain>{{ s.phone }}</van-tag>
                <van-tag v-if="s.guardian_phone" plain>家长 {{ s.guardian_phone }}</van-tag>
              </div>
              <div class="attend-actions">
                <van-tag v-if="s.credits.lessons_total" :type="s.credits.owed ? 'danger' : s.credits.low ? 'warning' : 'success'" plain>
                  余 {{ s.credits.remaining }}
                </van-tag>
                <van-tag v-if="s.owed_makeups" type="warning" plain>欠 {{ s.owed_makeups }}</van-tag>
                <van-tag v-if="s.user_id" plain type="success">已绑定</van-tag>
                <span v-else class="muted">未绑定</span>
                <van-icon v-if="auth.canTeach" name="setting-o" size="18" style="cursor: pointer" @click="openStudentEdit(s)" />
                <van-icon v-if="auth.canTeach" name="delete-o" color="#ee0a24" size="18" style="cursor: pointer" @click="removeStudent(s)" />
              </div>
            </div>
            <van-empty v-if="!info.students.length" image="search" description="暂无学生" style="padding: 20px 0" />
          </div>
        </div>
      </div>

      <template v-if="auth.canTeach">
        <div class="section-head">
          <span>待补课</span>
          <span class="muted link" @click="loadMakeups">
            {{ makeups ? `${makeups.filter((m) => m.status === 'pending').length} 节待补` : '查看' }}
          </span>
        </div>
        <div class="card">
          <div v-if="!makeups" class="muted" style="text-align: center; padding: 12px 0">
            学生请假后会自动记一笔待补课
          </div>
          <div v-else-if="!makeups.length" class="muted" style="text-align: center; padding: 12px 0">没有欠课</div>
          <div v-else>
            <div v-for="m in makeups" :key="m.id" class="attend-row">
              <div class="attend-name">
                <span>{{ m.student_name }}</span>
                <van-tag :type="m.status === 'pending' ? 'warning' : m.status === 'done' ? 'success' : 'default'" plain>
                  {{ { pending: '待补', scheduled: '已约', done: '已补', waived: '免补' }[m.status] }}
                </van-tag>
                <span class="muted" style="font-size: 12px">缺 {{ m.missed_date }}</span>
              </div>
              <div class="attend-actions">
                <van-button v-if="m.status !== 'done'" size="mini" round type="primary" plain @click="settleMakeup(m, 'done')">已补</van-button>
                <van-button v-if="m.status === 'pending'" size="mini" round plain @click="settleMakeup(m, 'waived')">免补</van-button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-if="auth.canTeach && stats">
        <div class="section-head">
          <span>调课记录</span>
          <span class="muted link" @click="loadChanges">{{ changes.length ? `${changes.length} 条` : '查看' }}</span>
        </div>
        <div class="card">
          <ChangeLogList :changes="changes" />
        </div>

        <div class="section-head">
          <span>出勤统计</span>
          <span class="muted">按已记录的 {{ stats.total_lessons }} 节课统计</span>
        </div>
        <div class="card">
          <!-- 桌面端：完整表格 -->
          <table v-if="isDesktop" class="stat-table">
            <thead>
              <tr>
                <th>学生</th>
                <th>出勤</th>
                <th>迟到</th>
                <th>缺勤</th>
                <th>请假</th>
                <th>已签名</th>
                <th>出勤率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in stats.stats" :key="s.id">
                <td>{{ s.name }}</td>
                <td>{{ s.present }}</td>
                <td>{{ s.late }}</td>
                <td>{{ s.absent }}</td>
                <td>{{ s.leave }}</td>
                <td>{{ s.signed }}</td>
                <td>
                  <div v-if="s.rate != null" class="rate-bar">
                    <div class="rate-track">
                      <div class="rate-fill" :style="{ width: `${s.rate}%`, background: s.rate >= 80 ? '#07c160' : s.rate >= 60 ? '#ff976a' : '#ee0a24' }" />
                    </div>
                    <span>{{ s.rate }}%</span>
                  </div>
                  <span v-else class="muted">暂无记录</span>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 手机端：紧凑列表 -->
          <template v-else>
            <div v-for="s in stats.stats" :key="s.id" class="stat-row">
              <div class="stat-row-top">
                <span class="stat-row-name">{{ s.name }}</span>
                <span v-if="s.rate != null" class="stat-row-rate">{{ s.rate }}%</span>
                <span v-else class="muted">暂无记录</span>
              </div>
              <div v-if="s.rate != null" class="rate-track" style="margin: 6px 0">
                <div class="rate-fill" :style="{ width: `${s.rate}%`, background: s.rate >= 80 ? '#07c160' : s.rate >= 60 ? '#ff976a' : '#ee0a24' }" />
              </div>
              <div class="muted">
                出勤 {{ s.present }} · 迟到 {{ s.late }} · 缺勤 {{ s.absent }} · 请假 {{ s.leave }} · 已签名 {{ s.signed }}
              </div>
            </div>
            <van-empty v-if="!stats.stats.length" image="search" description="暂无统计" style="padding: 16px 0" />
          </template>
        </div>
      </template>

      <div v-if="billing" class="card">
        <div style="display: flex; align-items: center; justify-content: space-between">
          <span style="font-size: 15px; font-weight: 600">收费结算</span>
          <input v-model="billMonth" type="month" style="border: 1px solid #d9dfec; border-radius: 8px; padding: 5px 8px; font-family: inherit" @change="loadBilling" />
        </div>
        <div class="muted" style="margin-top: 8px">
          {{ billing.range[0] }} 至 {{ billing.range[1] }} · 课次 {{ billing.lesson_count }} ·
          <b style="color: #07c160">合计应收 {{ billing.total_amount }} 元</b>
        </div>
        <div v-if="!billing.class.rate" class="muted" style="margin-top: 6px; color: #e07a00">
          还没设置单节课酬，先在「班级设置」里填写
        </div>
        <div v-for="s in billing.stats" :key="s.id" style="border-top: 1px solid #f1f3f8; padding: 10px 0 2px">
          <div style="display: flex; align-items: baseline; gap: 8px">
            <span style="font-size: 14px; font-weight: 600; flex: 1">{{ s.name }}</span>
            <span style="font-size: 14px; font-weight: 700; color: var(--van-primary-color)">{{ s.amount }} 元</span>
          </div>
          <div class="muted" style="margin-top: 3px">
            出勤 {{ s.attended }}<span v-if="s.late">（含迟到 {{ s.late }}）</span> · 请假 {{ s.leave }} · 缺勤 {{ s.absent }} · 未记录 {{ s.unmarked }}
          </div>
        </div>
        <van-empty v-if="!billing.stats.length" image="search" description="班级还没有学生" style="padding: 14px 0" />
        <div style="margin-top: 12px">
          <van-button size="small" round block plain icon="down" @click="exportBilling">导出结算单 CSV</van-button>
        </div>
        <div class="muted" style="margin-top: 8px">口径：出勤与迟到计费，请假与缺勤不计费</div>
      </div>

      <div class="section-head">
        <span>近期课时</span>
        <span class="link" @click="router.push('/schedule')">全部排课 ›</span>
      </div>
      <div :class="isDesktop ? 'grid-auto' : ''">
        <LessonCard v-for="l in upcoming" :key="l.id" :lesson="l" :show-date="true" />
      </div>
      <van-empty v-if="!upcoming.length" image="search" description="暂无排课" style="padding: 16px 0" />
    </template>

    <van-popup
      v-model:show="showAdd"
      round
      class="eduhub-popup"
      :position="isDesktop ? 'center' : 'bottom'"
      style="padding: 18px 4px 24px"
    >
      <div class="form-title">添加学生</div>
      <van-cell-group inset>
        <van-field v-model="form.name" label="姓名" placeholder="学生姓名" clearable />
        <van-field v-model="form.phone" label="手机号" placeholder="选填" clearable />
        <van-field v-model="form.guardian_phone" label="家长电话" placeholder="选填" clearable />
        <van-field v-model.number="form.lessons_total" type="digit" label="购买课时" placeholder="0 = 未购课时包" />
        <van-field v-model.number="form.lessons_bonus" type="digit" label="赠送课时" placeholder="选填" />
        <van-field v-model="form.remark" label="备注" placeholder="选填" clearable />
      </van-cell-group>
      <div class="muted" style="margin: 10px 20px 0">学生也可以自行注册后用邀请码加入班级。</div>
      <div style="margin: 16px">
        <van-button round block type="primary" :loading="saving" @click="addStudent">添加</van-button>
      </div>
    </van-popup>

    <van-popup
      v-model:show="showEdit"
      round
      class="eduhub-popup"
      :position="isDesktop ? 'center' : 'bottom'"
      style="padding: 18px 4px 24px"
    >
      <div class="form-title">课时与资料 · {{ editTarget?.name }}</div>
      <van-cell-group inset>
        <van-field v-model="editForm.name" label="姓名" clearable />
        <van-field v-model="editForm.phone" label="手机号" placeholder="选填" clearable />
        <van-field v-model="editForm.guardian_phone" label="家长电话" placeholder="选填" clearable />
        <van-field v-model.number="editForm.lessons_total" type="digit" label="购买课时" />
        <van-field v-model.number="editForm.lessons_bonus" type="digit" label="赠送课时" />
        <van-field v-model="editForm.remark" label="备注" placeholder="选填" clearable />
      </van-cell-group>
      <div v-if="editTarget" style="margin: 12px 20px 0; display: flex; gap: 6px; flex-wrap: wrap">
        <van-tag :type="editTarget.credits.owed ? 'danger' : editTarget.credits.low ? 'warning' : 'success'" plain>
          剩余 {{ editTarget.credits.remaining }} 节
        </van-tag>
        <van-tag plain>已消 {{ editTarget.credits.used }} 节</van-tag>
        <van-tag v-if="editTarget.owed_makeups" type="warning" plain>待补 {{ editTarget.owed_makeups }} 节</van-tag>
      </div>
      <div class="muted" style="margin: 10px 20px 0; font-size: 12px">
        已消课时 = 已完成课时里的出勤/迟到/缺勤；请假不扣，改为计入待补课
      </div>
      <div style="margin: 16px">
        <van-button round block type="primary" :loading="savingEdit" @click="saveStudentEdit">保存</van-button>
      </div>
    </van-popup>
  </div>
</template>
