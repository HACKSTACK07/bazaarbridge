import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function SaveForLater() {
  const [savedItems, setSavedItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(new Set())
  const [removing, setRemoving] = useState(new Set())
  const [showChanges, setShowChanges] = useState(null)
  const [error, setError] = useState('')

  const fetchSaved = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/cart')
      const cart = res ?? { items: [] }
      const saved = cart.items?.filter(item => item.saved_for_later) ?? []
      setSavedItems(saved)
    } catch (err) {
      setError(err.body?.message ?? 'Failed to load saved items')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSaved()
  }, [fetchSaved])

  const handleRestore = async (cartItemId, savedPrice) => {
    setRestoring(prev => new Set(prev).add(cartItemId))
    try {
      await api.post(`/cart/items/${cartItemId}/restore`)
      fetchSaved()
    } catch (err) {
      if (err.code === 'PRICE_CHANGED') {
        // Show price change modal
        setShowChanges({ cartItemId, newPrice: err.body.current_price_paise, oldPrice: savedPrice })
      } else {
        setError(err.body?.message ?? 'Failed to restore item')
        console.error(err)
      }
    } finally {
      setRestoring(prev => {
        const next = new Set(prev)
        next.delete(cartItemId)
        return next
      })
    }
  }

  const handleConfirmRestore = async () => {
    if (!showChanges) return
    setRestoring(prev => new Set(prev).add(showChanges.cartItemId))
    try {
      await api.post(`/cart/items/${showChanges.cartItemId}/restore`)
      setShowChanges(null)
      fetchSaved()
    } catch (err) {
      setError(err.body?.message ?? 'Failed to restore item')
      console.error(err)
    } finally {
      setRestoring(prev => {
        const next = new Set(prev)
        next.delete(showChanges.cartItemId)
        return next
      })
    }
  }

  const handleRemove = async (cartItemId) => {
    if (!window.confirm('Permanently remove this item?')) return
    setRemoving(prev => new Set(prev).add(cartItemId))
    try {
      await api.delete(`/cart/items/${cartItemId}`)
      fetchSaved()
    } catch (err) {
      setError(err.body?.message ?? 'Failed to remove item')
      console.error(err)
    } finally {
      setRemoving(prev => {
        const next = new Set(prev)
        next.delete(cartItemId)
        return next
      })
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/4" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse flex items-center space-x-4">
            <div className="w-20 h-20 bg-gray-200 rounded" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-3 bg-gray-200 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Saved for Later</h1>
        <p className="mt-1 text-gray-600">{savedItems.length} item{savedItems.length !== 1 ? 's' : ''} — restoring revalidates price & stock</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      {showChanges && (
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-6" role="dialog" aria-modal="true" aria-labelledby="changes-title">
          <h2 id="changes-title" className="text-lg font-semibold text-gray-900 mb-4">Price Changed Since Saved</h2>
          <div className="space-y-3">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="font-medium text-yellow-800">The price has changed since you saved this item.</p>
              <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Saved price:</span>
                  <span className="font-medium text-gray-900 ml-2">{formatPaise(showChanges.oldPrice)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Current price:</span>
                  <span className="font-medium text-gray-900 ml-2">{formatPaise(showChanges.newPrice)}</span>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-600">Restoring will use the current price. The payable amount will not change silently.</p>
            </div>
            <div className="flex space-x-3 justify-end">
              <button
                onClick={() => setShowChanges(null)}
                className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRestore}
                disabled={restoring.has(showChanges.cartItemId)}
                className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {restoring.has(showChanges.cartItemId) ? 'Restoring...' : 'Restore at Current Price'}
              </button>
            </div>
          </div>
        </div>
      )}

      {savedItems.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-16 w-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">Nothing saved for later</h3>
          <p className="mt-2 text-gray-500">Move items from your cart to save them for later.</p>
          <Link to="/cart" className="mt-6 inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Go to Cart
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-200">
          {savedItems.map((item) => (
            <div key={item.cart_item_id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-20 h-20 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center">
                <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <Link to={`/products/${item.product_id}`} className="font-medium text-gray-900 hover:text-blue-600 truncate block">
                  {item.offer_id ? `Offer ${item.offer_id.slice(0, 8)}` : 'Product'}
                </Link>
                <p className="text-sm text-gray-500 mt-1">Qty: {item.quantity}</p>
              </div>
              <div className="text-right sm:text-left">
                <p className="text-lg font-bold text-gray-900">{formatPaise(item.price_snapshot)}</p>
                <p className="text-xs text-gray-500">Saved price</p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleRestore(item.cart_item_id, item.price_snapshot)}
                  disabled={restoring.has(item.cart_item_id)}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {restoring.has(item.cart_item_id) ? 'Restoring...' : 'Restore to Cart'}
                </button>
                <button
                  onClick={() => handleRemove(item.cart_item_id)}
                  disabled={removing.has(item.cart_item_id)}
                  className="px-4 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50"
                >
                  {removing.has(item.cart_item_id) ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}