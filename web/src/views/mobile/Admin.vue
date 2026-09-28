<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import api, { toastError } from '../../api';
import { useAuthStore } from '../../store';
import { ROLE_LEVEL_LABEL, roleLabel } from '../../roles';

const router = useRouter();
const auth = useAuthStore();
const tab = ref('users');
const stats = ref(null);
const users = ref([]);
const classes = ref([]);
const loading = ref(true);
const filterRole = ref('');

const showActions = ref(false);
const current = ref(null);
const showReset = ref(false);
const newPassword = ref('');
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    const params = {};
    if (filterRole.value) params.role = filterRole.value;
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

    <van-tabs v-model:active="tab">
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
