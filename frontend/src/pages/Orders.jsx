import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const fetchOrders = useCallback(async () => {
    try {
      const res = await api.get('/orders')
      setOrders(res ?? [])
    } catch (err) {
      setError(err.body?.message ?? 'Failed to load orders')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/4" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
            <div className="flex justify-between">
              <div className="h-4 bg-gray-200 rounded w-1/4" />
              <div className="h-4 bg-gray-200 rounded w-1/6" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Unable to load orders</h3>
        <p className="mt-1 text-sm text-gray-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">My Orders</h1>
        <p className="mt-1 text-gray-600">Track your order status and delivery progress.</p>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-16 w-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a2 2 0 00-2-2H5a2 2 0 00-2 2v4m0 0a2 2 0 012 2h14a2 2 0 012-2v-4" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 11a2 2 0 012 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 01-2-2H5z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No orders yet</h3>
          <p className="mt-2 text-gray-500">When you place an order, it will appear here.</p>
          <Link to="/products" className="mt-6 inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Start Shopping
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <Link
              key={order.order_id}
              to={`/orders/${order.order_id}`}
              className="block bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
            >
              <div className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center space-x-4">
                    <div className="flex-shrink-0 w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a2 2 0 00-2-2H5a2 2 0 00-2 2v4m0 0a2 2 0 012 2h14a2 2 0 012-2v-4" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Order {order.order_id.slice(0, 8)}</p>
                      <p className="text-sm text-gray-500">{new Date(order.placed_at).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 text-right sm:text-left">
                    <div>
                      <p className="text-lg font-bold text-gray-900">{formatPaise(order.total_amount)}</p>
                      <p className="text-sm text-gray-500">{order.items?.length ?? 0} item(s)</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      {order.status === 'placed' && <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Placed</span>}
                      {order.status === 'confirmed' && <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">Confirmed</span>}
                      {order.status === 'delivered' && <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Delivered</span>}
                      {order.status === 'cancelled' && <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">Cancelled</span>}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}