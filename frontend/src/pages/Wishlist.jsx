import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function Wishlist() {
  const [wishlist, setWishlist] = useState([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState(new Set())
  const [error, setError] = useState('')

  const fetchWishlist = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/wishlist')
      setWishlist(res ?? [])
    } catch (err) {
      setError(err.body?.message ?? 'Failed to load wishlist')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWishlist()
  }, [fetchWishlist])

  const handleRemove = async (wishlistId) => {
    if (!window.confirm('Remove from wishlist?')) return
    setRemoving(prev => new Set(prev).add(wishlistId))
    try {
      await api.delete(`/wishlist/${wishlistId}`)
      fetchWishlist()
    } catch (err) {
      setError(err.body?.message ?? 'Failed to remove from wishlist')
      console.error(err)
    } finally {
      setRemoving(prev => {
        const next = new Set(prev)
        next.delete(wishlistId)
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
        <h1 className="text-3xl font-bold text-gray-900">Wishlist</h1>
        <p className="mt-1 text-gray-600">{wishlist.length} item{wishlist.length !== 1 ? 's' : ''} saved for later</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      {wishlist.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-16 w-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">Your wishlist is empty</h3>
          <p className="mt-2 text-gray-500">Products you save will appear here.</p>
          <Link to="/products" className="mt-6 inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Start Shopping
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-200">
          {wishlist.map((item) => (
            <div key={item.wishlist_id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-20 h-20 flex-shrink-0 bg-gray-100 rounded-lg flex items-center justify-center">
                <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <Link to={`/products/${item.product_id}`} className="font-medium text-gray-900 hover:text-blue-600 truncate block">
                  {item.product_name ?? `Product ${item.product_id?.slice(0, 8)}`}
                </Link>
                <p className="text-sm text-gray-500 mt-1">{item.brand}</p>
                <p className="text-sm text-gray-400">{item.category_name}</p>
              </div>
              <div className="text-right sm:text-left">
                <p className="text-lg font-bold text-gray-900">{formatPaise(item.current_price_paise ?? 0)}</p>
                <p className="text-sm text-gray-500">Added {new Date(item.added_at).toLocaleDateString()}</p>
              </div>
              <button
                onClick={() => handleRemove(item.wishlist_id)}
                disabled={removing.has(item.wishlist_id)}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                aria-label="Remove from wishlist"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}