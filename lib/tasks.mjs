import crypto from 'node:crypto';

const tasks = new Map();
const TASK_TTL_MS = 1000 * 60 * 60;

function nowIso() {
  return new Date().toISOString();
}

function cleanupExpiredTasks() {
  const cutoff = Date.now() - TASK_TTL_MS;
  for (const [id, task] of tasks.entries()) {
    if (new Date(task.updatedAt).getTime() < cutoff) {
      tasks.delete(id);
    }
  }
}

function cloneTask(task) {
  return JSON.parse(JSON.stringify(task));
}

export function createTask(input) {
  cleanupExpiredTasks();
  const task = {
    id: crypto.randomUUID(),
    kind: input.kind,
    platform: input.platform,
    title: input.title,
    status: 'running',
    message: input.message || '',
    qrDataUrl: null,
    qrUpdatedAt: null,
    logs: [],
    results: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  tasks.set(task.id, task);
  return cloneTask(task);
}

export function updateTask(taskId, patch) {
  const task = tasks.get(taskId);
  if (!task) {
    return null;
  }
  Object.assign(task, patch, { updatedAt: nowIso() });
  return cloneTask(task);
}

export function appendTaskLog(taskId, message) {
  const task = tasks.get(taskId);
  if (!task) {
    return null;
  }
  task.logs.push({
    message,
    at: nowIso(),
  });
  task.updatedAt = nowIso();
  return cloneTask(task);
}

export function appendTaskResult(taskId, result) {
  const task = tasks.get(taskId);
  if (!task) {
    return null;
  }
  task.results.push(result);
  task.updatedAt = nowIso();
  return cloneTask(task);
}

export function finishTask(taskId, patch = {}) {
  return updateTask(taskId, {
    status: 'completed',
    ...patch,
  });
}

export function failTask(taskId, error) {
  return updateTask(taskId, {
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}

export function getTask(taskId) {
  const task = tasks.get(taskId);
  return task ? cloneTask(task) : null;
}

export function findRunningTask({ kind, platform }) {
  cleanupExpiredTasks();
  for (const task of tasks.values()) {
    if (task.status !== 'running') {
      continue;
    }
    if (kind && task.kind !== kind) {
      continue;
    }
    if (platform && task.platform !== platform) {
      continue;
    }
    return cloneTask(task);
  }
  return null;
}
