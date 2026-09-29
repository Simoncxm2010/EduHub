<script setup>
import { computed, onMounted, ref } from 'vue';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import Modal from '../../ui/Modal.vue';
import { ROLE_LEVEL_LABEL, roleLabel } from '../../roles';

const auth = useAuthStore();
const tab = ref('users');
const stats = ref(null);
const users = ref([]);
const classes = ref([]);
const loading = ref(true);

const filterRole = ref('');
const filterStatus = ref('');
const keyword = ref('');

const showCreate = ref(false);
const newUser = ref({ name: '', phone: '', password: '', role: 'teacher' });
const showReset = ref(false);
const resetTarget = ref(null);
const newPassword = ref('');
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    const params = {};
    if (filterRole.value) params.role = filterRole.value;
    if (filterStatus.value) params.status = filterStatus.value;
    if (keyword.value.trim()) params.q = keyword.value.trim();
    const [s, u, c] = await Promise.all([
      api.get('/admin/stats'),
      api.get('/admin/users', { params }),
      api.get('/admin/classes'),
    ]);
    stats.value = s;
    users.value = u.users;
    classes.value = c.classes;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

/** 可否操作某用户：不能动自己，也不能动同级或更高级别 */
function canManage(u) {
  if (u.id === auth.user?.id) return false;
  if (ROLE_LEVEL_LABEL[u.role] >= ROLE_LEVEL_LABEL[auth.user?.role]) return false;
  return true;
}

/** 可分配的角色：超管可分配所有人；管理员只能管教师/学生 */
const assignableRoles = computed(() => (auth.isSuper
  ? ['student', 'teacher', 'admin', 'super']
  : ['student', 'teacher']));

async function changeRole(u, role) {
  if (role === u.role) return;
  try {
    await api.put(`/admin/users/${u.id}/role`, { role });
    showToast({ type: 'success', message: `${u.name} 已设为${roleLabel(role)}` });
    load();
  } catch (e) {
    toastError(e);
    load();
  }
}

async function toggleStatus(u) {
  const next = u.status === 'active' ? 'disabled' : 'active';
  if (next === 'disabled') {
    try {
      await showConfirmDialog({
        title: '停用账号',
        message: `停用后「${u.name}」将无法登录，已登录状态也会立即失效。确定吗？`,
        confirmButtonText: '停用',
      });
    } catch {
      return;
    }
  }
  try {
    await api.put(`/admin/users/${u.id}/status`, { status: next });
    showToast(next === 'disabled' ? '已停用' : '已启用');
    load();
  } catch (e) {
    toastError(e);
  }
}

function openReset(u) {
  resetTarget.value = u;
  newPassword.value = '';
  showReset.value = true;
}

async function submitReset() {
  if (newPassword.value.length < 6) return showToast('新密码至少 6 位');
  busy.value = true;
  try {
    await api.put(`/admin/users/${resetTarget.value.id}/password`, { password: newPassword.value });
    showToast({ type: 'success', message: '密码已重置' });
    showReset.value = false;
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function createUser() {
  busy.value = true;
  try {
    await api.post('/admin/users', newUser.value);
    showToast({ type: 'success', message: '账号已创建' });
    showCreate.value = false;
    newUser.value = { name: '', phone: '', password: '', role: 'teacher' };
    load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function removeUser(u) {
  try {
    await showConfirmDialog({
      title: '删除账号',
      message: `将永久删除「${u.name}」及其名下班级、排课数据，不可恢复。确定吗？`,
      confirmButtonText: '确认删除',
    });
  } catch {
    return;
  }
  try {
    await api.delete(`/admin/users/${u.id}`);
    showToast('已删除');
    load();
  } catch (e) {
    toastError(e);
  }
}

/* ---------------- 超管专属：系统信息与审计日志（运维/开发领地） ---------------- */
const system = ref(null);
const auditLogs = ref([]);
const auditTotal = ref(0);
const auditAction = ref('');
const auditOffset = ref(0);
const auditLoading = ref(false);
const AUDIT_CN = {
  create_user: '新建账号', set_role: '调整角色', set_status: '启停用账号',
  reset_password: '重置密码', delete_user: '删除账号',
};
const AUDIT_ACTIONS = Object.keys(AUDIT_CN);

async function loadSuperPanels(append = false) {
  if (!auth.isSuper) return;
  auditLoading.value = true;
  try {
    const [sys, audit] = await Promise.all([
      api.get('/admin/system'),
      api.get('/admin/audit', {
        params: { limit: 50, offset: auditOffset.value, action: auditAction.value || undefined },
      }),
    ]);
    system.value = sys;
    auditTotal.value = audit.total;
    // 「加载更多」追加下一页，筛选/刷新时整页替换
    auditLogs.value = append
      ? [...auditLogs.value, ...audit.logs.filter((l) => !auditLogs.value.some((x) => x.id === l.id))]
      : audit.logs;
  } catch (e) {
    toastError(e);
  } finally {
    auditLoading.value = false;
  }
}

function filterAudit() {
  auditOffset.value = 0;
  loadSuperPanels();
}

function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

const systemItems = computed(() => {
  if (!system.value) return [];
  const s = system.value;
  return [
    { label: 'Node 版本', value: s.node },
    { label: '运行平台', value: s.platform },
    { label: '运行时长', value: fmtUptime(s.uptime_s) },
    { label: '内存占用', value: `${s.memory.rss_mb} MB（堆 ${s.memory.heap_used_mb} MB）` },
    { label: '数据库体积', value: fmtBytes(s.db_size) },
    { label: '上传目录', value: `${fmtBytes(s.uploads.size)} · ${s.uploads.count} 个文件` },
    { label: '账号 / 班级', value: `${s.counts.users} 个账号（停用 ${s.counts.disabled_users}）· ${s.counts.classes} 个班级` },
    { label: '课时 / 待审', value: `${s.counts.lessons} 节（已完成 ${s.counts.lessons_done}）· ${s.counts.pending_requests} 条待审` },
  ];
});

</script>

<template>
  <div class="d-page">
    <div class="d-head">
        <div>
          <h1>管理后台</h1>
          <div class="sub">
            当前身份：{{ auth.roleLabel }}
            <template v-if="auth.isSuper"> · 运维与开发：系统信息、审计日志、账号与角色</template>
            <template v-else> · 机构管理者：管理教师与学生、班级与审批</template>
          </div>
        </div>
      <div class="d-head-actions">
        <button class="d-btn primary" @click="showCreate = true">新建账号</button>
      </div>
    </div>

    <div v-if="stats" class="d-grid-4" style="margin-bottom: 18px">
      <div class="d-stat">
        <div class="label"><van-icon name="user-o" size="15" /> 用户总数</div>
        <div class="value">{{ stats.total_users }}</div>
        <div class="label" style="margin-top: 6px">
          学生 {{ stats.roles.student }} · 教师 {{ stats.roles.teacher }} · 管理 {{ stats.roles.admin + stats.roles.super }}
        </div>
      </div>
      <div class="d-stat">
        <div class="label"><van-icon name="friends-o" size="15" /> 班级 / 学生</div>
        <div class="value">{{ stats.classes }}<span class="unit">班</span> {{ stats.students }}<span class="unit">人</span></div>
      </div>
      <div class="d-stat">
        <div class="label"><van-icon name="calendar-o" size="15" /> 课时总数</div>
        <div class="value">{{ stats.lessons }}<span class="unit">已完成 {{ stats.lessons_done }}</span></div>
      </div>
      <div class="d-stat">
        <div class="label"><van-icon name="warning-o" size="15" /> 需要留意</div>
        <div class="value" :style="stats.pending_requests || stats.disabled_users ? { color: '#e07a00' } : {}">
          {{ stats.pending_requests }}<span class="unit">待审申请</span> {{ stats.disabled_users }}<span class="unit">停用</span>
        </div>
      </div>
    </div>

    <div class="d-toolbar">
      <div class="d-tabs">
        <button :class="{ on: tab === 'users' }" @click="tab = 'users'">用户与权限</button>
        <button :class="{ on: tab === 'classes' }" @click="tab = 'classes'">全部班级</button>
        <button v-if="auth.isSuper" :class="{ on: tab === 'system' }" @click="tab = 'system'; loadSuperPanels()">系统信息</button>
        <button v-if="auth.isSuper" :class="{ on: tab === 'audit' }" @click="tab = 'audit'; loadSuperPanels()">审计日志</button>
      </div>
      <div class="spacer" />
      <template v-if="tab === 'users'">
        <input v-model="keyword" class="d-input" style="width: 180px" placeholder="搜姓名或手机号" @keyup.enter="load" />
        <select v-model="filterRole" class="d-select" style="width: 130px" @change="load">
          <option value="">全部角色</option>
          <option value="student">学生</option>
          <option value="teacher">教师</option>
          <option value="admin">管理员</option>
          <option value="super">超级管理员</option>
        </select>
        <select v-model="filterStatus" class="d-select" style="width: 120px" @change="load">
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="disabled">已停用</option>
        </select>
        <button class="d-btn" @click="load">查询</button>
      </template>
    </div>

    <!-- 用户与权限 -->
    <div v-if="tab === 'users'" class="d-card">
      <div v-if="loading" class="d-empty">加载中…</div>
      <div v-else-if="!users.length" class="d-empty"><strong>没有匹配的用户</strong>换个筛选条件试试</div>
      <div v-else class="d-scroll">
        <table class="d-table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>手机号</th>
              <th>角色与权限</th>
              <th class="center">班级</th>
              <th class="center">状态</th>
              <th>注册时间</th>
              <th class="actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" :style="u.status === 'disabled' ? { opacity: 0.62 } : {}">
              <td class="strong">
                {{ u.name }}
                <span v-if="u.id === auth.user?.id" class="d-badge info" style="margin-left: 6px">我</span>
              </td>
              <td>{{ u.phone }}</td>
              <td>
                <select
                  v-if="canManage(u) && (auth.isSuper || ['student', 'teacher'].includes(u.role))"
                  class="d-select"
                  style="width: 132px"
                  :value="u.role"
                  @change="changeRole(u, $event.target.value)"
                >
                  <option v-for="r in assignableRoles" :key="r" :value="r">{{ roleLabel(r) }}</option>
                </select>
                <span v-else class="d-badge" :class="u.role === 'super' ? 'danger' : u.role === 'admin' ? 'warn' : 'mute'">
                  {{ roleLabel(u.role) }}
                </span>
              </td>
              <td class="center">{{ u.class_count || u.student_count || 0 }}</td>
              <td class="center">
                <span class="d-badge" :class="u.status === 'active' ? 'ok' : 'danger'">
                  {{ u.status === 'active' ? '正常' : '已停用' }}
                </span>
              </td>
              <td style="font-size: 12.5px; color: #98a1b5">{{ u.created_at?.slice(0, 10) }}</td>
              <td class="actions">
                <template v-if="canManage(u)">
                  <button class="d-btn sm" @click="openReset(u)">重置密码</button>
                  <button class="d-btn sm" :class="u.status === 'active' ? 'danger' : ''" @click="toggleStatus(u)">
                    {{ u.status === 'active' ? '停用' : '启用' }}
                  </button>
                  <button v-if="auth.isSuper && u.role !== 'super'" class="d-btn sm danger" @click="removeUser(u)">删除</button>
                </template>
                <span v-else style="font-size: 12.5px; color: #b6bdcc">
                  {{ u.id === auth.user?.id ? '当前账号' : '无权操作' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 全部班级 -->
    <div v-else-if="tab === 'classes'" class="d-card">
      <div v-if="!classes.length" class="d-empty"><strong>还没有班级</strong></div>
      <div v-else class="d-scroll">
        <table class="d-table">
          <thead>
            <tr>
              <th>班级</th>
              <th>授课老师</th>
              <th>联系方式</th>
              <th class="center">学生</th>
              <th class="center">课时</th>
              <th class="num">单节课酬</th>
              <th>邀请码</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in classes" :key="c.id">
              <td>
                <span class="d-dot" :style="{ background: c.color, marginRight: '8px' }" />
                <span class="strong">{{ c.name }}</span>
              </td>
              <td>{{ c.teacher_name }}</td>
              <td>{{ c.teacher_phone }}</td>
              <td class="center">{{ c.student_count }}</td>
              <td class="center">{{ c.lesson_count }}</td>
              <td class="num">{{ c.rate ? `${c.rate} 元` : '—' }}</td>
              <td style="font-family: monospace; letter-spacing: 1px">{{ c.invite_code }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 系统信息（仅超管：运维/开发领地） -->
    <div v-else-if="tab === 'system'" class="d-card">
      <div v-if="!system" class="d-empty">加载中…</div>
      <template v-else>
        <div class="d-toolbar" style="margin-bottom: 12px">
          <span class="d-badge info">运行环境</span>
          <span class="d-badge mute">这些信息仅超管可见——机构管理员看不到运维细节</span>
        </div>
        <div class="d-grid-2">
          <div v-for="i in systemItems" :key="i.label" class="d-stat">
            <div class="label">{{ i.label }}</div>
            <div class="value" style="font-size: 17px">{{ i.value }}</div>
          </div>
        </div>
      </template>
    </div>

    <!-- 审计日志（仅超管） -->
    <div v-else-if="tab === 'audit'" class="d-card">
      <div class="d-toolbar" style="margin-bottom: 12px">
        <span class="d-badge info">管理员的建号 / 改角色 / 启停用 / 重置密码 / 删号记录</span>
        <div class="spacer" />
        <select v-model="auditAction" class="d-select" style="width: 150px" @change="filterAudit">
          <option value="">全部动作</option>
          <option v-for="(cn, key) in AUDIT_CN" :key="key" :value="key">{{ cn }}</option>
        </select>
        <button class="d-btn" :disabled="auditLoading" @click="filterAudit">刷新</button>
      </div>
      <div v-if="auditLoading" class="d-empty">加载中…</div>
      <div v-else-if="!auditLogs.length" class="d-empty"><strong>暂无审计记录</strong>管理员的敏感操作会记录在这里</div>
      <div v-else class="d-scroll" style="max-height: 480px">
        <table class="d-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作人</th>
              <th>动作</th>
              <th>对象</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in auditLogs" :key="l.id">
              <td style="white-space: nowrap; font-size: 12.5px; color: var(--eduhub-muted)">{{ l.created_at }}</td>
              <td>
                <span class="strong">{{ l.operator_name }}</span>
                <span class="d-badge mute" style="margin-left: 6px">{{ l.operator_role === 'super' ? '超管' : '管理员' }}</span>
              </td>
              <td><span class="d-badge info">{{ AUDIT_CN[l.action] || l.action }}</span></td>
              <td>{{ l.target_name || '—' }}</td>
              <td style="font-size: 12.5px; color: var(--eduhub-muted)">{{ l.detail || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="auditTotal > auditLogs.length" class="d-inline" style="margin-top: 12px">
        <button class="d-btn sm" :disabled="auditLoading" @click="auditOffset += 50; loadSuperPanels(true)">加载更多（已载 {{ auditLogs.length }} / 共 {{ auditTotal }} 条）</button>
      </div>
    </div>

    <Modal v-model:show="showCreate" title="新建账号" sub="可直接为老师或学生开通账号" @update:show="showCreate = $event">
      <div class="d-form two">
        <div class="d-field">
          <label>姓名 *</label>
          <input v-model="newUser.name" class="d-input" placeholder="如：王老师" />
        </div>
        <div class="d-field">
          <label>手机号 *</label>
          <input v-model="newUser.phone" class="d-input" placeholder="用于登录" />
        </div>
        <div class="d-field">
          <label>初始密码 *</label>
          <input v-model="newUser.password" class="d-input" placeholder="至少 6 位" />
        </div>
        <div class="d-field">
          <label>角色</label>
          <select v-model="newUser.role" class="d-select">
            <option v-for="r in assignableRoles" :key="r" :value="r">{{ roleLabel(r) }}</option>
          </select>
        </div>
      </div>
      <template #footer>
        <button class="d-btn" @click="showCreate = false">取消</button>
        <button class="d-btn primary" :disabled="busy" @click="createUser">创建</button>
      </template>
    </Modal>

    <Modal v-model:show="showReset" title="重置密码" :sub="resetTarget ? `为「${resetTarget.name}」设置新密码` : ''" size="narrow" @update:show="showReset = $event">
      <div class="d-field">
        <label>新密码</label>
        <input v-model="newPassword" class="d-input" placeholder="至少 6 位" @keyup.enter="submitReset" />
      </div>
      <template #footer>
        <button class="d-btn" @click="showReset = false">取消</button>
        <button class="d-btn primary" :disabled="busy" @click="submitReset">确认重置</button>
      </template>
    </Modal>
  </div>
</template>
