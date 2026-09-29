<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { ROLE_LEVEL_LABEL, roleLabel } from '../../roles';
import { cnDate } from '../../utils';
import { ensureHolidays, holidaySyncInfo } from '../../utils/holidays';

const router = useRouter();
const auth = useAuthStore();
const tab = ref('users');
const stats = ref(null);
const users = ref([]);
const classes = ref([]);
const loading = ref(true);
const filterRole = ref('');

/* 超管专属：系统信息与审计日志（运维/开发领地） */
const system = ref(null);
const auditLogs = ref([]);
const auditTotal = ref(0);
const auditLoading = ref(false);
const AUDIT_CN = {
  create_user: '新建账号', set_role: '调整角色', set_status: '启停用账号',
  reset_password: '重置密码', delete_user: '删除账号',
};

function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d ? `${d} 天 ${h} 小时` : `${h} 小时`;
}

async function loadSuperPanels() {
  if (!auth.isSuper) return;
  auditLoading.value = true;
  try {
    const [sys, audit] = await Promise.all([
      api.get('/admin/system'),
      api.get('/admin/audit', { params: { limit: 30 } }),
    ]);
    system.value = sys;
    auditLogs.value = audit.logs;
    auditTotal.value = audit.total;
  } catch (e) {
    toastError(e);
  } finally {
    auditLoading.value = false;
  }
}

/** 切到某个标签页时按需加载（Vant 的标签内容是懒渲染的） */
function onTabChange(name) {
  if (name === 'holidays') loadHolidays();
  if (name === 'system' || name === 'audit') loadSuperPanels();
}

const showActions = ref(false);
const current = ref(null);
const showReset = ref(false);
const newPassword = ref('');
const busy = ref(false);

/* ---------------- 法定节假日数据 ---------------- */

const holidayInfo = ref(null);
const holidaySyncing = ref(false);

async function loadHolidays(force = false) {
  try {
    const map = await ensureHolidays(force);
    holidayInfo.value = { map, sync: holidaySyncInfo() };
  } catch (e) {
    toastError(e);
  }
}

async function syncHolidays() {
  holidaySyncing.value = true;
  try {
    const d = await api.post('/holidays/refresh', { force: true });
    showToast(d.updated ? `已同步 ${d.updated} 年` : d.message || '暂无新数据');
    await loadHolidays(true);
  } catch (e) {
    toastError(e);
  } finally {
    holidaySyncing.value = false;
  }
}

const holidaySync = computed(() => holidayInfo.value?.sync || null);
const holidayRangeText = computed(() => {
  const dates = Object.keys(holidayInfo.value?.map || {}).sort();
  return dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '—';
});
const syncedYearsText = computed(() => {
  const years = holidaySync.value?.years || [];
  return years.length ? years.map((y) => y.year).join('、') : '尚未同步';
});
/** 今天起的节假日，最多列 40 条 */
const holidayRows = computed(() => {
  const map = holidayInfo.value?.map || {};
  const t = new Date().toLocaleDateString('en-CA');
  return Object.entries(map)
    .filter(([d]) => d >= t)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 40)
    .map(([date, info]) => ({ date, ...info }));
});

async function load() {
  loading.value = true;
  try {
    const params = {};
    if (filterRole.value) params.role = filterRole.value;
    const calls = [api.get('/admin/stats'), api.get('/admin/users', { params }), api.get('/admin/classes')];
    if (auth.isSuper) calls.push(api.get('/admin/system'), api.get('/admin/audit', { params: { limit: 20 } }));
    const [s, u, c, sys, audit] = await Promise.all(calls);
    stats.value = s;
    users.value = u.users;
    classes.value = c.classes;
    if (auth.isSuper) {
      system.value = sys;
      auditLogs.value = audit.logs;
      auditTotal.value = audit.total;
    }
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function canManage(u) {
  if (u.id === auth.user?.id) return false;
  return ROLE_LEVEL_LABEL[u.role] < ROLE_LEVEL_LABEL[auth.user?.role];
}

function openActions(u) {
  current.value = u;
  showActions.value = true;
}

async function changeRole(role) {
  busy.value = true;
  try {
    await api.put(`/admin/users/${current.value.id}/role`, { role });
    showToast({ type: 'success', message: '角色已更新' });
    showActions.value = false;
    load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function toggleStatus() {
  const u = current.value;
  const next = u.status === 'active' ? 'disabled' : 'active';
  busy.value = true;
  try {
    await api.put(`/admin/users/${u.id}/status`, { status: next });
    showToast(next === 'disabled' ? '已停用' : '已启用');
    showActions.value = false;
    load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

function openReset() {
  newPassword.value = '';
  showReset.value = true;
}

async function submitReset() {
  if (newPassword.value.length < 6) return showToast('新密码至少 6 位');
  busy.value = true;
  try {
    await api.put(`/admin/users/${current.value.id}/password`, { password: newPassword.value });
    showToast({ type: 'success', message: '密码已重置' });
    showReset.value = false;
    showActions.value = false;
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function removeUser() {
  try {
    await showConfirmDialog({
      title: '删除账号',
      message: `将永久删除「${current.value.name}」及其数据，不可恢复。确定吗？`,
      confirmButtonText: '删除',
    });
  } catch {
    return;
  }
  try {
    await api.delete(`/admin/users/${current.value.id}`);
    showToast('已删除');
    showActions.value = false;
    load();
  } catch (e) {
    toastError(e);
  }
}
</script>

<template>
  <div class="page">
    <van-nav-bar title="管理后台" left-arrow @click-left="router.back()" />

    <div v-if="stats" class="card stats">
      <div style="display: flex; text-align: center">
        <div style="flex: 1"><div class="stat-num">{{ stats.total_users }}</div><div class="stat-label">用户</div></div>
        <div style="flex: 1"><div class="stat-num">{{ stats.classes }}</div><div class="stat-label">班级</div></div>
        <div style="flex: 1"><div class="stat-num">{{ stats.lessons }}</div><div class="stat-label">课时</div></div>
        <div style="flex: 1">
          <div class="stat-num" :style="stats.pending_requests ? { color: '#e07a00' } : {}">{{ stats.pending_requests }}</div>
          <div class="stat-label">待审</div>
        </div>
      </div>
      <div class="muted" style="text-align: center; margin-top: 8px">
        学生 {{ stats.roles.student }} · 教师 {{ stats.roles.teacher }} · 管理 {{ stats.roles.admin + stats.roles.super }}
        <template v-if="stats.disabled_users"> · 已停用 {{ stats.disabled_users }}</template>
      </div>
    </div>

    <div class="card" v-if="auth.isSuper" style="display: flex; align-items: center; gap: 10px">
      <van-icon name="shield-o" size="20" color="#e07a00" />
      <div style="flex: 1">
        <div style="font-size: 14px; font-weight: 500">你是超级管理员</div>
        <div class="muted">可以分配管理员权限、删除账号</div>
      </div>
    </div>

    <van-tabs v-model:active="tab" @change="onTabChange">
      <van-tab title="用户与权限" name="users">
        <div class="filter-bar" style="margin-top: 10px">
          <span class="chip" :class="{ on: !filterRole }" @click="filterRole = ''; load()">全部</span>
          <span
            v-for="r in ['student', 'teacher', 'admin', 'super']"
            :key="r"
            class="chip"
            :class="{ on: filterRole === r }"
            @click="filterRole = r; load()"
          >{{ roleLabel(r) }}</span>
        </div>

        <van-loading v-if="loading" style="margin: 24px auto" vertical>加载中…</van-loading>
        <template v-else>
          <div v-for="u in users" :key="u.id" class="card" :style="u.status === 'disabled' ? { opacity: 0.62 } : {}">
            <div style="display: flex; align-items: center; gap: 10px">
              <div class="class-chip" style="width: 36px; height: 36px; font-size: 15px; background: linear-gradient(135deg, #4f6ef2, #7b93ff)">
                {{ u.name.slice(0, 1) }}
              </div>
              <div style="flex: 1; min-width: 0">
                <div style="font-size: 14.5px; font-weight: 600">
                  {{ u.name }}
                  <van-tag v-if="u.id === auth.user?.id" plain type="primary" style="margin-left: 4px">我</van-tag>
                </div>
                <div class="muted" style="margin-top: 3px">{{ u.phone }}</div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
                <van-tag :type="u.role === 'super' ? 'danger' : u.role === 'admin' ? 'warning' : 'primary'" plain>
                  {{ roleLabel(u.role) }}
                </van-tag>
                <van-tag v-if="u.status === 'disabled'" type="danger" plain>已停用</van-tag>
              </div>
            </div>
            <div style="margin-top: 10px" v-if="canManage(u)">
              <van-button size="small" round block plain @click="openActions(u)">管理该账号</van-button>
            </div>
          </div>
          <van-empty v-if="!users.length" image="search" description="没有匹配的用户" />
        </template>
      </van-tab>

      <van-tab title="全部班级" name="classes">
        <div v-for="c in classes" :key="c.id" class="card">
          <div style="display: flex; align-items: center; gap: 8px">
            <span class="lesson-dot" :style="{ background: c.color }" />
            <span style="font-weight: 600">{{ c.name }}</span>
            <div style="flex: 1" />
            <span class="muted">{{ c.student_count }} 人 · {{ c.lesson_count }} 节</span>
          </div>
          <div class="muted" style="margin-top: 6px">
            {{ c.teacher_name }}（{{ c.teacher_phone }}） · 邀请码 {{ c.invite_code }}
            <template v-if="c.rate"> · 单节 {{ c.rate }} 元</template>
          </div>
        </div>
        <van-empty v-if="!classes.length" image="search" description="还没有班级" />
      </van-tab>

      <!-- 法定节假日数据（管理员）：排课日历与智能排课都依赖这份数据 -->
      <van-tab title="法定节假日" name="holidays">
        <div class="card">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px">
            <span style="font-weight: 600">国家法定节假日</span>
            <div style="flex: 1" />
            <van-button size="mini" :loading="holidaySyncing" :disabled="!holidaySync?.enabled" @click="syncHolidays">
              立即同步
            </van-button>
          </div>
          <div v-if="!holidayInfo" class="muted" style="text-align: center; padding: 14px 0">加载中…</div>
          <template v-else>
            <div class="attend-row">
              <div class="attend-name"><span class="muted">数据来源</span></div>
              <div style="font-size: 13px; text-align: right">
                {{ holidaySync?.enabled ? '每日自动同步' : '自动同步已关闭' }}
              </div>
            </div>
            <div class="attend-row">
              <div class="attend-name"><span class="muted">覆盖范围</span></div>
              <div style="font-size: 13px; text-align: right">{{ holidayRangeText }}</div>
            </div>
            <div class="attend-row">
              <div class="attend-name"><span class="muted">已同步年份</span></div>
              <div style="font-size: 13px; text-align: right">{{ syncedYearsText }}</div>
            </div>
            <div v-if="(holidaySync?.estimated_years || []).length" class="muted" style="margin-top: 10px; font-size: 12px">
              {{ holidaySync.estimated_years.join('、') }} 年安排尚未公布，当前为推算的占位数据，同步后自动覆盖。
            </div>
          </template>
        </div>

        <div class="section-head"><span>今天起的节假日</span></div>
        <div v-for="h in holidayRows" :key="h.date" class="card" style="padding: 12px 14px">
          <div style="display: flex; align-items: center; gap: 8px">
            <span style="font-weight: 600">{{ cnDate(h.date) }}</span>
            <van-tag :type="h.type === 'workday' ? 'primary' : 'danger'" plain>
              {{ h.type === 'workday' ? '调休补班' : '放假' }}
            </van-tag>
            <div style="flex: 1" />
            <span class="muted">{{ h.name }}</span>
          </div>
        </div>
        <van-empty v-if="holidayInfo && !holidayRows.length" image="search" description="今天起没有更多节假日数据" />
      </van-tab>

      <!-- 系统信息（仅超管：运维/开发领地） -->
      <van-tab v-if="auth.isSuper" title="系统信息" name="system">
        <div class="card">
          <div v-if="!system" class="muted" style="text-align: center; padding: 14px 0">加载中…</div>
          <template v-else>
            <div class="muted" style="margin-bottom: 10px">仅超管可见——机构管理员看不到运维细节</div>
            <div v-for="i in [
              { label: 'Node 版本', value: system.node },
              { label: '运行平台', value: system.platform },
              { label: '运行时长', value: fmtUptime(system.uptime_s) },
              { label: '内存占用', value: `${system.memory.rss_mb} MB` },
              { label: '数据库体积', value: fmtBytes(system.db_size) },
              { label: '上传目录', value: `${fmtBytes(system.uploads.size)} · ${system.uploads.count} 个文件` },
              { label: '账号 / 班级', value: `${system.counts.users} 个（停用 ${system.counts.disabled_users}）· ${system.counts.classes} 班` },
            ]" :key="i.label" class="attend-row">
              <div class="attend-name"><span class="muted">{{ i.label }}</span></div>
              <div style="font-size: 13.5px; font-weight: 600; text-align: right">{{ i.value }}</div>
            </div>
          </template>
        </div>
      </van-tab>

      <!-- 审计日志（仅超管） -->
      <van-tab v-if="auth.isSuper" title="审计日志" name="audit">
        <div v-for="l in auditLogs" :key="l.id" class="card">
          <div style="display: flex; align-items: center; gap: 8px">
            <van-tag type="primary" plain>{{ AUDIT_CN[l.action] || l.action }}</van-tag>
            <span style="font-weight: 600; font-size: 14px">{{ l.operator_name }}</span>
            <van-tag plain>{{ l.operator_role === 'super' ? '超管' : '管理员' }}</van-tag>
            <div style="flex: 1" />
            <span class="muted">{{ (l.created_at || '').slice(5, 16) }}</span>
          </div>
          <div class="muted" style="margin-top: 6px">
            对象：{{ l.target_name || '—' }}<template v-if="l.detail"> · {{ l.detail }}</template>
          </div>
        </div>
        <van-empty v-if="!auditLogs.length" image="search" description="暂无审计记录" />
        <div v-if="auditTotal > auditLogs.length" class="muted" style="text-align: center; padding: 6px 0 14px">
          共 {{ auditTotal }} 条，手机端仅展示最近 {{ auditLogs.length }} 条
        </div>
      </van-tab>
    </van-tabs>

    <van-popup v-model:show="showActions" round position="bottom" style="padding: 18px 16px 24px">
      <div class="form-title">{{ current?.name }}</div>
      <div v-if="current" class="muted" style="text-align: center; margin-bottom: 16px">
        {{ current.phone }} · 当前{{ roleLabel(current.role) }}
      </div>

      <template v-if="showReset">
        <van-field v-model="newPassword" label="新密码" placeholder="至少 6 位" />
        <div style="margin-top: 14px">
          <van-button round block type="primary" :loading="busy" @click="submitReset">确认重置密码</van-button>
        </div>
        <div style="margin-top: 10px">
          <van-button round block plain @click="showReset = false">返回</van-button>
        </div>
      </template>

      <template v-else>
        <div class="muted" style="margin-bottom: 8px">分配角色</div>
        <div class="seg" style="margin-bottom: 16px">
          <span
            v-for="r in (auth.isSuper ? ['student', 'teacher', 'admin', 'super'] : ['student', 'teacher'])"
            :key="r"
            class="seg-item"
            :class="{ on: current?.role === r }"
            :style="current?.role === r ? { background: '#4f6ef2' } : {}"
            @click="changeRole(r)"
          >{{ roleLabel(r) }}</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px">
          <van-button round block plain @click="openReset">重置密码</van-button>
          <van-button round block plain :type="current?.status === 'active' ? 'danger' : 'primary'" :loading="busy" @click="toggleStatus">
            {{ current?.status === 'active' ? '停用账号' : '启用账号' }}
          </van-button>
          <van-button v-if="auth.isSuper && current?.role !== 'super'" round block plain type="danger" @click="removeUser">
            删除账号
          </van-button>
        </div>
      </template>
    </van-popup>
  </div>
</template>
