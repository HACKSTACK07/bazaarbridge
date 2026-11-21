import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../kit/api'

const SPEC_LABELS = {
  brand: 'Brand',
  color: 'Color',
  storage: 'Storage',
  ram: 'RAM',
  screen_size: 'Screen Size',
  processor: 'Processor',
  camera: 'Camera',
  battery: 'Battery',
  os: 'Operating System',
  warranty: 'Warranty',
  weight: 'Weight',
  dimensions: 'Dimensions',
}

export default function Compare() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [productIds, setProductIds] = useState(searchParams.get('ids')?.split(',').filter(Boolean) ?? [])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)

  const fetchComparison = useCallback(async () => {
    if (productIds.length < 2) return
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/products/compare?ids=${productIds.join(',')}`)
      setProducts(res ?? [])
    } catch (err) {
      setError(err.body?.message ?? 'Failed to load comparison')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [productIds])

  useEffect(() => {
    fetchComparison()
  }, [fetchComparison])

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!searchQuery.trim() || searching) return
    setSearching(true)
    try {
      const res = await api.get(`/search?q=${encodeURIComponent(searchQuery)}`)
      setSearchResults(res.hits ?? [])
    } catch (err) {
      setError(err.body?.message ?? 'Search failed')
      console.error(err)
    } finally {
      setSearching(false)
    }
  }

  const addProduct = (productId) => {
    if (productIds.includes(productId)) return
    if (productIds.length >= 3) {
      setError('Maximum 3 products for comparison')
      return
    }
    const newIds = [...productIds, productId]
    setProductIds(newIds)
    setSearchParams({ ids: newIds.join(',') })
    setSearchQuery('')
    setSearchResults([])
  }

  const removeProduct = (productId) => {
    const newIds = productIds.filter(id => id !== productId)
    setProductIds(newIds)
    setSearchParams({ ids: newIds.join(',') })
  }

  const getAllSpecKeys = () => {
    const keys = new Set()
    products.forEach(p => {
      if (p.specs) Object.keys(p.specs).forEach(k => keys.add(k))
    })
    return Array.from(keys).sort()
  }

  const getSpecValue = (product, key) => {
    if (!product.specs || !(key in product.specs)) return 'Not available'
    const value = product.specs[key]
    if (value === null || value === undefined || value === '') return 'Not available'
    return String(value)
  }

  if (productIds.length === 0) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Compare Products</h1>
          <p className="mt-1 text-gray-600">Select up to 3 products from the same category to compare specifications side by side.</p>
        </div>

        <form onSubmit={handleSearch} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Search Products to Compare</h2>
          <div className="flex space-x-2">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for products..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={searching}
            />
            <button
              type="submit"
              disabled={searching || !searchQuery.trim()}
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-900 mb-2">Results (click to add):</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {searchResults.map((hit) => (
                  <button
                    key={hit.product_id}
                    type="button"
                    onClick={() => addProduct(hit.product_id)}
                    disabled={productIds.includes(hit.product_id) || productIds.length >= 3}
                    className="p-3 border border-gray-200 rounded-lg text-left hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <p className="font-medium text-gray-900 truncate">
                      {hit.product_name ?? `Product ${hit.product_id.slice(0, 8)}`}
                    </p>
                    <p className="text-sm text-gray-500">Click to add</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto animate-pulse space-y-6">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="w-48 h-10 bg-gray-200" />
                {[...Array(productIds.length)].map((_, i) => (
                  <th key={i} className="h-10 bg-gray-200" />
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(8)].map((_, row) => (
                <tr key={row}>
                  <td className="w-48 h-10 bg-gray-200" />
                  {[...Array(productIds.length)].map((_, i) => (
                    <td key={i} className="h-10 bg-gray-200" />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (error && products.length === 0) {
    return (
      <div className="max-w-3xl mx-auto text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Comparison failed</h3>
        <p className="mt-1 text-sm text-gray-500">{error}</p>
      </div>
    )
  }

  const specKeys = getAllSpecKeys()

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Compare Products</h1>
          <p className="mt-1 text-gray-600">{products.length} product{products.length !== 1 ? 's' : ''} selected</p>
        </div>
        <button
          onClick={() => { setProductIds([]); setSearchParams({}); }}
          className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
        >
          Clear All
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <p className="text-sm font-medium text-gray-900 mb-2">Selected Products:</p>
        <div className="flex flex-wrap gap-2">
          {products.map((product) => (
            <span key={product.product_id} className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-sm font-medium rounded-full">
              {product.name}
              <button
                type="button"
                onClick={() => removeProduct(product.product_id)}
                className="ml-2 text-blue-500 hover:text-blue-700"
                aria-label="Remove"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
          {products.length < 3 && (
            <form onSubmit={handleSearch} className="flex items-center space-x-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Add another product..."
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
                disabled={searching}
              />
              <button
                type="submit"
                disabled={searching || !searchQuery.trim() || products.length >= 3}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Add
              </button>
            </form>
          )}
        </div>
        {searchResults.length > 0 && products.length < 3 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-gray-900 mb-2">Search Results:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {searchResults.map((hit) => (
                <button
                  key={hit.product_id}
                  type="button"
                  onClick={() => addProduct(hit.product_id)}
                  disabled={productIds.includes(hit.product_id) || products.length >= 3}
                  className="p-3 border border-gray-200 rounded-lg text-left hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <p className="font-medium text-gray-900 truncate">
                    {hit.product_name ?? `Product ${hit.product_id.slice(0, 8)}`}
                  </p>
                  <p className="text-sm text-gray-500">Add to compare</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {products.length >= 2 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="w-48 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Specification
                  </th>
                  {products.map((product) => (
                    <th key={product.product_id} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-900 truncate max-w-xs">{product.name}</span>
                        <span className="text-xs text-gray-400">{product.brand ?? ''}</span>
                        <span className="text-xs text-gray-400 px-2 py-0.5 bg-gray-100 rounded">{product.category_name ?? ''}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="w-48 px-4 py-3 text-sm font-medium text-gray-900">Price</td>
                  {products.map((product) => (
                    <td key={product.product_id} className="px-4 py-3 text-sm text-gray-900 font-semibold">
                      ₹{product.current_price_paise ? (product.current_price_paise / 100).toLocaleString('en-IN') : '—'}
                    </td>
                  ))}
                </tr>
                {specKeys.map((key) => (
                  <tr key={key}>
                    <td className="w-48 px-4 py-3 text-sm font-medium text-gray-900">
                      {SPEC_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </td>
                    {products.map((product) => (
                      <td key={product.product_id} className="px-4 py-3 text-sm text-gray-700">
                        <span className={getSpecValue(product, key) === 'Not available' ? 'text-gray-400 italic' : ''}>
                          {getSpecValue(product, key)}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
                {specKeys.length === 0 && (
                  <tr>
                    <td className="w-48 px-4 py-3 text-sm font-medium text-gray-900">Specifications</td>
                    {products.map((product) => (
                      <td key={product.product_id} className="px-4 py-3 text-sm text-gray-400 italic">
                        No structured specifications available
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {products.length === 1 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">Add another product to compare</h3>
          <p className="mt-2 text-gray-500">Select at least 2 products from the same category for a side-by-side comparison.</p>
        </div>
      )}
    </div>
  )
}