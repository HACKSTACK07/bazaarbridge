import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function ProductDetail() {
  const { id } = useParams()
  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchProduct() {
      setLoading(true)
      setError('')
      try {
        const res = await api.get(`/products/${id}`)
        setProduct(res)
      } catch (err) {
        setError('Failed to load product')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchProduct()
  }, [id])

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1">
            <div className="aspect-square bg-gray-200 rounded" />
          </div>
          <div className="md:col-span-2 space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/2" />
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="h-32 bg-gray-200 rounded" />
            <div className="h-4 bg-gray-200 rounded w-1/3" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Product not found</h3>
        <Link to="/products" className="mt-4 inline-block text-blue-600 hover:text-blue-500">
          ← Back to products
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link to="/products" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to products
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center">
            <svg className="w-24 h-24 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
        </div>
        <div className="md:col-span-2 space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{product.name}</h1>
            {product.brand && (
              <p className="mt-1 text-lg text-gray-500">{product.brand}</p>
            )}
            <p className="mt-2 text-sm text-gray-400">{product.category_name ?? 'Uncategorized'}</p>
          </div>
          <div className="prose max-w-none text-gray-600">
            {product.description ? (
              <p>{product.description}</p>
            ) : (
              <p className="text-gray-400">No description available.</p>
            )}
          </div>
          {product.specs && Object.keys(product.specs).length > 0 && (
            <div className="border-t pt-4">
              <h3 className="font-semibold text-gray-900">Specifications</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {Object.entries(product.specs).map(([key, value]) => (
                  <React.Fragment key={key}>
                    <dt className="text-gray-500">{key}</dt>
                    <dd className="font-medium text-gray-900">{String(value)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>

      <div className="border-t pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Compare Dealers</h2>
          <Link
            to={`/products/${id}/compare`}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            View Comparison →
          </Link>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Compare prices, delivery times, ratings, and availability across all dealers for this product.
        </p>
      </div>
    </div>
  )
}