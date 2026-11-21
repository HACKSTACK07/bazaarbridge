import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function ProductList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const categoryId = searchParams.get('category') || ''

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError('')
      try {
        const [catsRes, productsRes] = await Promise.all([
          api.get('/search/filters'),
          api.get(`/products${categoryId ? `?category=${categoryId}` : ''}`)
        ])
        setCategories(catsRes.categories ?? [])
        setProducts(productsRes ?? [])
      } catch (err) {
        setError('Failed to load products')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [categoryId])

  const handleCategoryChange = (catId) => {
    const params = new URLSearchParams(searchParams)
    if (catId) {
      params.set('category', catId)
    } else {
      params.delete('category')
    }
    setSearchParams(params)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Products</h1>
          <p className="mt-1 text-gray-600">
            {categoryId
              ? categories.find(c => c.category_id === categoryId)?.category_name ?? 'Category'
              : 'All categories'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleCategoryChange('')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !categoryId
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.category_id}
            onClick={() => handleCategoryChange(cat.category_id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              categoryId === cat.category_id
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {cat.category_name}
          </button>
        ))}
      </div>

      {loading ? (
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
      ) : error ? (
        <div className="text-center text-red-600 py-8">{error}</div>
      ) : products.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No products found</h3>
          <p className="mt-1 text-sm text-gray-500">Try a different category or search term.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {products.map((product) => (
            <Link
              key={product.product_id}
              to={`/products/${product.product_id}`}
              className="group block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="aspect-square bg-gray-100 flex items-center justify-center relative">
                <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div className="p-4">
                <h3 className="font-medium text-gray-900 group-hover:text-blue-600 truncate">
                  {product.name}
                </h3>
                {product.brand && (
                  <p className="text-sm text-gray-500 mt-1">{product.brand}</p>
                )}
                <p className="text-sm text-gray-400 mt-1">{product.category_name ?? 'Uncategorized'}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}