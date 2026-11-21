import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api, getAuthToken, setAuthToken, clearAuth } from '../kit/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchUser = useCallback(async () => {
    const token = getAuthToken()
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const res = await api.get('/auth/me')
      setUser(res.user)
    } catch {
      clearAuth()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password })
    setAuthToken(res.token)
    setUser(res.user)
    return res.user
  }

  const logout = () => {
    clearAuth()
    setUser(null)
  }

  const value = { user, loading, login, logout, refreshUser: fetchUser }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}