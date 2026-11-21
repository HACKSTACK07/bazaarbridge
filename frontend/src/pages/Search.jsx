import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [category, setCategory] = useState(searchParams.get('category') || '')
  const [maxPrice, setMaxPrice] = useState(searchParams.get('max_price') || '')
  const [city, setCity] = useState(searchParams.get('city') || '')
  const [quick, setQuick] = useState(searchParams.get('quick') === 'true')

  const [results, setResults] = useState({ hits: [] })
  const [filters, setFilters] = useState({ categories: [], cities: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchFilters = useCallback(async () => {
    try {
      const res = await api.get('/search/filters')
      setFilters({ categories: res.categories ?? [], cities: res.cities ?? [] })
    } catch (err) {
      console.error('Failed to fetch filters:', err)
    }
  }, [])

  const fetchResults = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (category) params.set('category', category)
      if (maxPrice) params.set('max_price', maxPrice)
      if (city) params.set('city', city)
      if (quick) params.set('quick', 'true')

      const res = await api.get(`/search?${params.toString()}`)
      setResults(res)
    } catch (err) {
      setError(err.body?.message ?? 'Search failed')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [query, category, maxPrice, city, quick])

  useEffect(() => {
    fetchFilters()
  }, [fetchFilters])

  useEffect(() => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (category) params.set('category', category)
    if (maxPrice) params.set('max_price', maxPrice)
    if (city) params.set('city', city)
    if (quick) params.set('quick', 'true')
    setSearchParams(params)
  }, [query, category, maxPrice, city, quick, setSearchParams])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchResults()
    }, 300)
    return () => clearTimeout(timer)
  }, [fetchResults])

  const handleSearch = (e) => {
    e.preventDefault()
    fetchResults()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Search Products</h1>
        <p className="mt-1 text-gray-600">Find products across all dealers. Try "bluetoth" for typo-tolerant search.</p>
      </div>

      <form onSubmit={handleSearch} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <div>
          <label htmlFor="search-query" className="sr-only">Search query</label>
          <input
            id="search-query"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products... (e.g., bluetoth)"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor="category-filter" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              id="category-filter"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All categories</option>
              {filters.categories.map((cat) => (
                <option key={cat.category_id} value={cat.category_id}>
                  {cat.category_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="max-price-filter" className="block text-sm font-medium text-gray-700 mb-1">Max Price (₹)</label>
            <input
              id="max-price-filter"
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="e.g., 50000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label htmlFor="city-filter" className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <select
              id="city-filter"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All cities</option>
              {filters.cities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={quick}
                onChange={(e) => setQuick(e.target.checked)}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Quick delivery only</span>
            </label>
          </div>
        </div>
      </form>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="animate-pulse space-y-2">
              <div className="aspect-square bg-gray-200 rounded" />
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
              <div className="h-5 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="text-center text-red-600 py-8">{error}</div>
      )}

      {!loading && !error && results.hits.length === 0 && query && (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No results found</h3>
          <p className="mt-1 text-sm text-gray-500">Try adjusting your filters or search term.</p>
        </div>
      )}

      {!loading && results.hits.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{results.hits.length} result{results.hits.length !== 1 ? 's' : ''}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {results.hits.map((hit) => (
              <Link
                key={hit.offer_id}
                to={`/products/${hit.product_id}`}
                className="group block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="aspect-square bg-gray-100 flex items-center justify-center">
                  <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div className="p-4">
                  <h3 className="font-medium text-gray-900 group-hover:text-blue-600 truncate">
                    Product {hit.product_id.slice(0, 8)}
                  </h3>
                  <p className="text-sm text-gray-400 mt-1">Offer {hit.offer_id.slice(0, 8)}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}