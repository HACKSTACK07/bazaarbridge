import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function OutsideBangalore() {
  const [data, setData] = useState({ section_a: [], section_b: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError('')
      try {
        const res = await api.get('/outside-bangalore')
        setData({ section_a: res.section_a ?? [], section_b: res.section_b ?? [] })
      } catch (err) {
        setError(err.body?.message ?? 'Failed to load outside-Bangalore offers')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const renderSection = (title, description, offers, isSectionA) => (
    <section className="mb-12" aria-labelledby={isSectionA ? 'section-a' : 'section-b'}>
      <div className="mb-6">
        <h2 id={isSectionA ? 'section-a' : 'section-b'} className="text-2xl font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-gray-600">{description}</p>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse space-y-2">
              <div className="aspect-square bg-gray-200 rounded" />
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-5 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : offers.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 2 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No offers available</h3>
          <p className="mt-2 text-gray-500">No dealers currently have matching products in this category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {offers.map((offer) => (
            <Link
              key={offer.offer_id}
              to={`/products/${offer.product_id}`}
              className="group block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="aspect-square bg-gray-100 flex items-center justify-center relative">
                <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                {offer.verified && (
                  <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                    Verified
                  </span>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-medium text-gray-900 group-hover:text-blue-600 truncate">
                  {offer.product_name ?? `Product ${offer.product_id?.slice(0, 8)}`}
                </h3>
                <p className="text-sm text-gray-500 mt-1">{offer.brand}</p>
                <p className="text-sm text-gray-400 mt-1">{offer.category_name}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-bold text-gray-900">{formatPaise(offer.selling_price)}</span>
                </div>
                <div className="mt-3 space-y-1 text-sm text-gray-600">
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 2 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                    </svg>
                    <span>
                      {isSectionA
                        ? `In Bangalore — {offer.bangalore_delivery_days} day${offer.bangalore_delivery_days !== 1 ? 's' : ''}`
                        : `From ${offer.origin_city}, ${offer.origin_state} — ~${offer.transfer_days_max} days`}
                    </span>
                  </div>
                  {!isSectionA && offer.fulfilment_route && (
                    <div className="flex items-center space-x-1 text-xs text-gray-500">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      <span>Route: {offer.fulfilment_route}</span>
                    </div>
                  )}
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{offer.available_units ?? 0} units</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4 text-yellow-500 fill-current" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.784-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <span>{offer.dealer_rating?.toFixed(1) ?? '—'}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Outside Bangalore Deals</h1>
        <p className="mt-1 text-gray-600">
          Products from dealers outside Bangalore. Section A has stock in our Bangalore warehouse (faster delivery).
          Section B requires inter-location transfer (~2-3 days).
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      {renderSection(
        'In Bangalore Stock (Faster)',
        'These dealers have inventory already in our Bangalore warehouse for quicker delivery.',
        data.section_a,
        true
      )}

      {renderSection(
        'Moved from Another Stock Location (~2-3 days)',
        'These dealers hold stock at regional locations. Transfer to Bangalore takes 2-3 days before delivery.',
        data.section_b,
        false
      )}
    </div>
  )
}