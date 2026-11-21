import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function Home() {
  const [categories, setCategories] = useState([])
  const [featuredProducts, setFeaturedProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchData() {
      try {
        const [catsRes, productsRes] = await Promise.all([
          api.get('/search/filters'),
          api.get('/products')
        ])
        setCategories(catsRes.categories ?? [])
        setFeaturedProducts(productsRes.slice(0, 8))
      } catch (err) {
        setError('Failed to load home data')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-square bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Discover Local Deals</h1>
        <p className="mt-2 text-gray-600">Compare prices, check stock, and order from multiple dealers in one cart.</p>
      </div>

      {categories.length > 0 && (
        <section aria-labelledby="categories-heading">
          <h2 id="categories-heading" className="text-2xl font-semibold text-gray-900 mb-4">Categories</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {categories.map((cat) => (
              <Link
                key={cat.category_id}
                to={`/products?category=${cat.category_id}`}
                className="group p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-center"
              >
                <div className="text-lg font-medium text-gray-900 group-hover:text-blue-700">
                  {cat.category_name}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {featuredProducts.length > 0 && (
        <section aria-labelledby="featured-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="featured-heading" className="text-2xl font-semibold text-gray-900">Featured Products</h2>
            <Link to="/products" className="text-sm font-medium text-blue-600 hover:text-blue-500">
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredProducts.map((product) => (
              <Link
                key={product.product_id}
                to={`/products/${product.product_id}`}
                className="group block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="aspect-square bg-gray-100 flex items-center justify-center">
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
        </section>
      )}

      {error && (
        <div className="text-center text-red-600 py-8">
          {error}
        </div>
      )}
    </div>
  )
}