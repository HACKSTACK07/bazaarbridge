import { useState, useEffect } from 'react'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

export default function Coupons() {
  const [coupons, setCoupons] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [validating, setValidating] = useState(false)
  const [code, setCode] = useState('')
  const [validationResult, setValidationResult] = useState(null)

  const fetchCoupons = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/coupons')
      setCoupons(res ?? [])
    } catch (err) {
      setError(err.body?.message ?? 'Failed to load coupons')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCoupons()
  }, [fetchCoupons])

  const handleValidate = async (e) => {
    e.preventDefault()
    if (!code.trim() || validating) return

    setValidating(true)
    setError('')
    setValidationResult(null)

    try {
      // Need a basket total for validation - we'll use a placeholder
      // In real usage, this would come from cart context
      const res = await api.post('/coupons/validate', {
        code: code.trim(),
        basket_total_paise: 100000 // placeholder
      })
      setValidationResult({ valid: true, ...res })
    } catch (err) {
      if (err.code === 'COUPON_LIMIT_REACHED') {
        setValidationResult({ valid: false, error: 'This coupon has reached its maximum redemption limit' })
      } else if (err.code === 'PER_CUSTOMER_LIMIT_REACHED') {
        setValidationResult({ valid: false, error: 'You have already used this coupon the maximum number of times' })
      } else {
        setValidationResult({ valid: false, error: err.body?.message ?? 'Invalid coupon code' })
      }
    } finally {
      setValidating(false)
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/4" />
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="h-10 bg-gray-200 rounded w-1/2" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Coupons</h1>
        <p className="mt-1 text-gray-600">Validate and view available coupons.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Validate Coupon</h2>
        <form onSubmit={handleValidate} className="space-y-4">
          <div>
            <label htmlFor="coupon-code" className="block text-sm font-medium text-gray-700 mb-1">
              Coupon Code
            </label>
            <div className="flex space-x-2">
              <input
                id="coupon-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SAVE10"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-uppercase"
                disabled={validating}
              />
              <button
                type="submit"
                disabled={validating || !code.trim()}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {validating ? 'Validating...' : 'Validate'}
              </button>
            </div>
          </div>

          {validationResult && (
            <div className={`p-4 rounded-lg ${validationResult.valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              {validationResult.valid ? (
                <div className="space-y-2">
                  <p className="font-medium text-green-800">Coupon is valid!</p>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-gray-500">Code</dt>
                    <dd className="font-mono text-gray-900">{validationResult.code}</dd>
                    <dt className="text-gray-500">Type</dt>
                    <dd className="text-gray-900 capitalize">{validationResult.kind}</dd>
                    <dt className="text-gray-500">Value</dt>
                    <dd className="text-gray-900">
                      {validationResult.kind === 'percent'
                        ? `${validationResult.value}%`
                        : formatPaise(validationResult.value)}
                    </dd>
                    <dt className="text-gray-500">Min Basket</dt>
                    <dd className="text-gray-900">{formatPaise(validationResult.min_basket_paise)}</dd>
                    <dt className="text-gray-500">Max Redemptions</dt>
                    <dd className="text-gray-900">{validationResult.max_redemptions ?? 'Unlimited'}</dd>
                    <dt className="text-gray-500">Per Customer Limit</dt>
                    <dd className="text-gray-900">{validationResult.per_customer_limit}</dd>
                    <dt className="text-gray-500">Valid Until</dt>
                    <dd className="text-gray-900">{validationResult.valid_to ? new Date(validationResult.valid_to).toLocaleDateString() : '—'}</dd>
                  </dl>
                </div>
              ) : (
                <p className="font-medium text-red-800">{validationResult.error}</p>
              )}
            </div>
          )}
        </form>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Available Coupons</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {coupons.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <p className="mt-2">No coupons available</p>
            </div>
          ) : (
            coupons.map((coupon) => (
              <div key={coupon.coupon_id} className="p-4 hover:bg-gray-50">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 font-bold text-sm rounded">{coupon.code}</span>
                      <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded capitalize">{coupon.kind}</span>
                      <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded">
                        {coupon.kind === 'percent' ? `${coupon.value}%` : formatPaise(coupon.value)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      Min order: {formatPaise(coupon.min_basket_paise)} • Valid until {new Date(coupon.valid_to).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {coupon.max_redemptions ? `Max uses: ${coupon.max_redemptions} (used: ${coupon.redeemed_count})` : 'Unlimited uses'} • Per customer: {coupon.per_customer_limit}
                    </p>
                  </div>
                  <button
                    onClick={() => { setCode(coupon.code); handleValidate({ preventDefault: () => {} }) }}
                    className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 text-sm"
                  >
                    Try this coupon
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}