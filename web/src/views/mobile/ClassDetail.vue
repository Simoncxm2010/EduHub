<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { isDesktop } from '../../composables/layout';
import { addDays, fmtDate } from '../../utils';
import LessonCard from '../../components/LessonCard.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const classId = Number(route.params.id);

const info = ref(null);
const upcoming = ref([]);
const stats = ref(null);
const loading = ref(true);
const exporting = ref(false);

async function load() {
  loading.value = true;
  try {
    info.value = await api.get(`/classes/${classId}`);
    const from = fmtDate(new Date());
    const d = await api.get('/lessons', { params: { from, to: addDays(from, 60), class_id: classId } });
    upcoming.value = d.lessons.slice(0, isDesktop.value ? 8 : 5);
    if (auth.canTeach) {
      stats.value = await api.get(`/classes/${classId}/stats`);
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
  try {
    await navigator.clipboard.writeText(info.value.class.invite_code);
    showToast('邀请码已复制');
  } catch {
    showToast(`邀请码：${info.value.class.invite_code}`);
  }
}

/* 学生管理（教师） */
const showAdd = ref(false);
const form = ref({ name: '', phone: '', remark: '' });
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
    <van-nav-bar title="班级详情" left-arrow @click-left="router.back()" />

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
            <div class="muted" style="text-align: center">学生注册后，在「班级」页输入邀请码即可加入</div>
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
              </div>
              <div class="attend-actions">
                <van-tag v-if="s.user_id" plain type="success">已绑定账号</van-tag>
                <span v-else class="muted">未绑定</span>
                <van-icon v-if="auth.canTeach" name="delete-o" color="#ee0a24" size="18" style="cursor: pointer" @click="removeStudent(s)" />
              </div>
            </div>
            <van-empty v-if="!info.students.length" image="search" description="暂无学生" style="padding: 20px 0" />
          </div>
        </div>
      </div>

      <template v-if="auth.canTeach && stats">
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
        <van-field v-model="form.remark" label="备注" placeholder="选填" clearable />
      </van-cell-group>
      <div class="muted" style="margin: 10px 20px 0">学生也可以自行注册后用邀请码加入班级。</div>
      <div style="margin: 16px">
        <van-button round block type="primary" :loading="saving" @click="addStudent">添加</van-button>
      </div>
    </van-popup>
  </div>
</template>
