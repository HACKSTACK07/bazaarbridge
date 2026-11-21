import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

const COMPARISON_CATEGORIES = [
  { key: 'budget', label: 'Best Budget', description: 'Lowest price first' },
  { key: 'fastest', label: 'Fastest Delivery', description: 'Quickest delivery first' },
  { key: 'rated', label: 'Best Rated Dealer', description: 'Highest rated dealers first' },
  { key: 'value', label: 'Best Value', description: 'Best overall score' },
  { key: 'available', label: 'Most Available', description: 'Most units in stock first' },
]

export default function Comparison() {
  const { id } = useParams()
  const [product, setProduct] = useState(null)
  const [activeTab, setActiveTab] = useState('budget')
  const [offers, setOffers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchProduct() {
      try {
        const res = await api.get(`/products/${id}`)
        setProduct(res)
      } catch (err) {
        console.error('Failed to load product:', err)
      }
    }
    fetchProduct()
  }, [id])

  useEffect(() => {
    async function fetchOffers() {
      setLoading(true)
      setError('')
      try {
        const res = await api.get(`/products/${id}/offers`, { params: { category: activeTab } })
        setOffers(res ?? [])
      } catch (err) {
        setError(err.body?.message ?? 'Failed to load comparison')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchOffers()
  }, [id, activeTab])

  const formatDeliveryDays = (days) => {
    if (days === null || days === undefined) return 'N/A'
    if (days === 0) return 'Today'
    return `${days} day${days !== 1 ? 's' : ''}`
  }

  if (!product) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-200 rounded w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link to={`/products/${id}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to {product.name}
      </Link>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
        {product.brand && <p className="mt-1 text-gray-500">{product.brand}</p>}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <nav className="border-b border-gray-200" aria-label="Comparison categories">
          <ul className="flex flex-wrap -mb-px" role="tablist">
            {COMPARISON_CATEGORIES.map((cat) => (
              <li key={cat.key} role="presentation">
                <button
                  role="tab"
                  aria-selected={activeTab === cat.key}
                  aria-controls={`panel-${cat.key}`}
                  id={`tab-${cat.key}`}
                  onClick={() => setActiveTab(cat.key)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === cat.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {cat.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-6">
          {loading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse flex items-center space-x-4 p-4 border border-gray-200 rounded-lg">
                  <div className="w-20 h-20 bg-gray-200 rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-1/2" />
                    <div className="h-3 bg-gray-200 rounded w-1/3" />
                    <div className="h-3 bg-gray-200 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center text-red-600 py-8">{error}</div>
          ) : offers.length === 0 ? (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">No offers available</h3>
              <p className="mt-1 text-sm text-gray-500">No dealers currently have this product in stock.</p>
            </div>
          ) : (
            <div className="space-y-4" role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
              {offers.map((offer, index) => (
                <div
                  key={offer.offer_id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center space-x-4 flex-1 min-w-0">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {offer.shop_name} ({offer.dealer_city}, {offer.dealer_state})
                        </p>
                        <p className="text-sm text-gray-500">
                          {offer.brand} • {offer.category_name} • {offer.warranty_months}mo warranty
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-right sm:text-left flex-1">
                      <div className="text-lg font-bold text-gray-900">{formatPaise(offer.selling_price)}</div>
                      <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{formatDeliveryDays(offer.effective_days)}</span>
                      </div>
                      <div className="flex items-center space-x-1 text-sm text-gray-600">
                        <svg className="w-4 h-4 text-yellow-500 fill-current" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        <span>{offer.dealer_rating?.toFixed(1) ?? '—'} ({offer.total_reviews ?? 0})</span>
                      </div>
                      <div className="text-sm text-gray-600">
                        {offer.available_units ?? 0} units
                      </div>
                    </div>
                  </div>

                  {offer.reason && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                        {offer.reason}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="text-sm text-gray-500 text-center">
        <p>Reason strings are provided by the API verbatim. Never composed client-side.</p>
      </div>
    </div>
  )
}