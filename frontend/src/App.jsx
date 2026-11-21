import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import AdminLogin from './pages/AdminLogin'
import Home from './pages/Home'
import ProductList from './pages/ProductList'
import ProductDetail from './pages/ProductDetail'
import Search from './pages/Search'
import Comparison from './pages/Comparison'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import OutsideBangalore from './pages/OutsideBangalore'
import Orders from './pages/Orders'
import OrderTracking from './pages/OrderTracking'
import Simulator from './pages/Simulator'
import Assistant from './pages/Assistant'
import Coupons from './pages/Coupons'
import Addresses from './pages/Addresses'
import Wishlist from './pages/Wishlist'
import SaveForLater from './pages/SaveForLater'
import Compare from './pages/Compare'
import './index.css'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  return user ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  return user ? <Navigate to="/" replace /> : children
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  return user && user.role === 'admin' ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>

  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/admin-login" element={<PublicRoute><AdminLogin /></PublicRoute>} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Home />} />
        <Route path="/products" element={<ProductList />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/search" element={<Search />} />
        <Route path="/products/:id/compare" element={<Comparison />} />
        <Route path="/outside-bangalore" element={<OutsideBangalore />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderTracking />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/coupons" element={<Coupons />} />
        <Route path="/addresses" element={<Addresses />} />
        <Route path="/wishlist" element={<Wishlist />} />
        <Route path="/saved-for-later" element={<SaveForLater />} />
        <Route path="/compare" element={<Compare />} />
      </Route>
      <Route element={<AdminRoute><Layout /></AdminRoute>}>
        <Route path="/simulator" element={<Simulator />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App