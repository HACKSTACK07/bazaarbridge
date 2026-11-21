const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

function getAuthHeaders() {
  const token = localStorage.getItem('bb_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...options.headers
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    const err = new Error(error.message ?? `HTTP ${res.status}`)
    err.status = res.status
    err.code = error.error
    err.body = error
    throw err
  }

  if (res.status === 204) {
    return null
  }

  return res.json()
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' })
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('bb_token', token)
  } else {
    localStorage.removeItem('bb_token')
  }
}

export function getAuthToken() {
  return localStorage.getItem('bb_token')
}

export function clearAuth() {
  localStorage.removeItem('bb_token')
}

export default api