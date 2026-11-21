import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'
import { usePolling } from '../kit/usePolling'

export default function Cart() {
  const [cart, setCart] = useState({ items: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(new Set())
  const navigate = useNavigate()

  const fetchCart = useCallback(async () => {
    try {
      const res = await api.get('/cart')
      setCart(res)
      setError('')
    } catch (err) {
      if (err.status !== 404) {
        setError(err.body?.message ?? 'Failed to load cart')
      }
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCart()
  }, [fetchCart])

  usePolling(fetchCart, 30000)

  const handleQuantityChange = async (cartItemId, newQuantity) => {
    if (newQuantity < 1) return
    setUpdating(prev => new Set(prev).add(cartItemId))
    try {
      await api.post('/cart/items', { cart_item_id: cartItemId, quantity: newQuantity })
      fetchCart()
    } catch (err) {
      setError(err.body?.message ?? 'Failed to update quantity')
    } finally {
      setUpdating(prev => {
        const next = new Set(prev)
        next.delete(cartItemId)
        return next
      })
    }
  }

  const handleRemove = async (cartItemId) => {
    if (!window.confirm('Remove this item from cart?')) return
    setUpdating(prev => new Set(prev).add(cartItemId))
    try {
      await api.delete(`/cart/items/${cartItemId}`)
      fetchCart()
    } catch (err) {
      setError(err.body?.message ?? 'Failed to remove item')
    } finally {
      setUpdating(prev => {
        const next = new Set(prev)
        next.delete(cartItemId)
        return next
      })
    }
  }

  const handleCheckout = () => {
    navigate('/checkout')
  }

  const getTimeRemaining = (expiresAt) => {
    if (!expiresAt) return null
    const now = new Date()
    const expiry = new Date(expiresAt)
    const diff = expiry - now
    if (diff <= 0) return { expired: true }
    const minutes = Math.floor(diff / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    return { minutes, seconds, expired: false }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/4" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
            <div className="flex space-x-4">
              <div className="w-20 h-20 bg-gray-200 rounded" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/2" />
                <div className="h-3 bg-gray-200 rounded w-1/3" />
                <div className="h-3 bg-gray-200 rounded w-1/4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error && cart.items.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a2 2 0 00-2-2H5a2 2 0 00-2 2v4m0 0a2 2 0 012 2h14a2 2 0 012-2v-4" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Unable to load cart</h3>
        <p className="mt-1 text-sm text-gray-500">{error}</p>
      </div>
    )
  }

  if (cart.items.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-16 w-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a2 2 0 00-2-2H5a2 2 0 00-2 2v4m0 0a2 2 0 012 2h14a2 2 0 012-2v-4" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 11a2 2 0 012 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 01-2-2H5z" />
        </svg>
        <h3 className="mt-4 text-lg font-medium text-gray-900">Your cart is empty</h3>
        <p className="mt-2 text-gray-500">Add some products to get started.</p>
        <Link to="/products" className="mt-6 inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Continue Shopping
        </Link>
      </div>
    )
  }

  const itemsTotal = cart.items.reduce((sum, item) => sum + (item.price_snapshot || 0) * item.quantity, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Shopping Cart</h1>
        <div className="text-sm text-gray-500">
          {cart.items.length} item{cart.items.length !== 1 ? 's' : ''}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <ul className="divide-y divide-gray-200" role="list">
          {cart.items.map((item) => {
            const timeRemaining = item.reservation_id ? getTimeRemaining(item.reservation_id.expires_at) : null
            const isUpdating = updating.has(item.cart_item_id)

            return (
              <li key={item.cart_item_id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-20 h-20 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center">
                  <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 truncate">
                    {item.offer_id ? `Offer ${item.offer_id.slice(0, 8)}` : 'Product'}
                  </h3>
                  <p className="text-sm text-gray-500">Price: {formatPaise(item.price_snapshot)}</p>
                  {item.reservation_id && timeRemaining && (
                    <div className="mt-1 flex items-center space-x-2">
                      {timeRemaining.expired ? (
                        <span className="text-xs text-red-600 font-medium">Reservation expired</span>
                      ) : (
                        <>
                          <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-xs font-medium text-gray-700">
                            Reserved: {timeRemaining.minutes}:{timeRemaining.seconds.toString().padStart(2, '0')} remaining
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-3">
                  <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                    <button
                      onClick={() => !isUpdating && handleQuantityChange(item.cart_item_id, item.quantity - 1)}
                      disabled={isUpdating || item.quantity <= 1}
                      className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Decrease quantity"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                      </svg>
                    </button>
                    <span className="px-4 py-1.5 text-center w-12 font-medium text-gray-900">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => !isUpdating && handleQuantityChange(item.cart_item_id, item.quantity + 1)}
                      disabled={isUpdating}
                      className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Increase quantity"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>

                  <div className="text-right w-24 sm:w-32">
                    <p className="font-semibold text-gray-900">
                      {formatPaise((item.price_snapshot || 0) * item.quantity)}
                    </p>
                  </div>

                  <button
                    onClick={() => !isUpdating && handleRemove(item.cart_item_id)}
                    disabled={isUpdating}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                    aria-label="Remove item"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <span className="text-lg font-medium text-gray-900">Subtotal</span>
          <span className="text-xl font-bold text-gray-900">{formatPaise(itemsTotal)}</span>
        </div>
        <p className="text-sm text-gray-500 mb-4">Delivery fees and taxes calculated at checkout.</p>
        <button
          onClick={handleCheckout}
          disabled={cart.items.length === 0}
          className="w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Proceed to Checkout
        </button>
        <Link to="/products" className="mt-3 block text-center text-sm text-blue-600 hover:text-blue-500">
          ← Continue Shopping
        </Link>
      </div>
    </div>
  )
}