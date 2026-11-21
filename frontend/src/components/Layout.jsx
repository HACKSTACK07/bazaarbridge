import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatPaise } from '../kit/formatPaise'

export default function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()

  const navLinks = [
    { path: '/', label: 'Home' },
    { path: '/products', label: 'Products' },
    { path: '/search', label: 'Search' },
    { path: '/cart', label: 'Cart' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-40">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <Link to="/" className="text-xl font-bold text-gray-900">BazaarBridge</Link>
              <div className="hidden md:ml-8 md:flex md:space-x-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      location.pathname === link.path
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {user && (
                <>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Demo user
                  </span>
                  <span className="text-sm text-gray-500">{user.name}</span>
                  <button
                    onClick={logout}
                    className="px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
                  >
                    Logout
                  </button>
                </>
              )}
              <Link
                to="/cart"
                className="relative p-2 text-gray-500 hover:text-gray-700"
                aria-label="Cart"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a2 2 0 00-2-2H5a2 2 0 00-2 2v4m0 0a2 2 0 012 2h14a2 2 0 012-2v-4" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11a2 2 0 012 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 01-2-2H5z" />
                </svg>
              </Link>
            </div>
          </div>
        </nav>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}