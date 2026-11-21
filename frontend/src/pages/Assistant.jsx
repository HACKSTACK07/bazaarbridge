import { useState, useEffect } from 'react'
import { api } from '../kit/api'
import { formatPaise } from '../kit/formatPaise'

const SAMPLE_PROMPTS = [
  'Find me a smartphone under ₹20000 with good camera',
  'Show me laptops with 16GB RAM in Bangalore',
  'Best budget headphones under ₹5000',
]

export default function Assistant() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({})
  const [results, setResults] = useState([])
  const [fallback, setFallback] = useState(false)
  const [error, setError] = useState('')

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setInput('')
    setLoading(true)
    setError('')
    setFilters({})
    setResults([])
    setFallback(false)

    try {
      const res = await api.post('/shopping-assistant', { message: userMessage })
      setMessages(prev => [...prev, { role: 'assistant', content: res.message ?? 'Here are the results:' }])
      setFilters(res.filters ?? {})
      setResults(res.offers ?? [])
      setFallback(res.fallback ?? false)
    } catch (err) {
      setError(err.body?.message ?? 'Assistant request failed')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleSamplePrompt = (prompt) => {
    setInput(prompt)
    handleSend({ preventDefault: () => {} })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Shopping Assistant</h1>
        <p className="mt-1 text-gray-600">
          Ask naturally — I'll extract filters and show matching offers.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-medium text-gray-900">Conversation</h2>
        </div>
        <div className="h-96 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="mt-2">Start a conversation below</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] px-4 py-2 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : 'bg-gray-100 text-gray-900 rounded-bl-none'
                }`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-900 px-4 py-2 rounded-2xl rounded-bl-none animate-pulse">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-200">
          <form onSubmit={handleSend} className="flex space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything..."
              disabled={loading}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Thinking...' : 'Send'}
            </button>
          </form>
          <p className="mt-3 text-xs text-gray-500">Try: {SAMPLE_PROMPTS.join(' • ')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SAMPLE_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSamplePrompt(prompt)}
                disabled={loading}
                className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(Object.keys(filters).length > 0 || results.length > 0) && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-medium text-gray-900">Extracted Filters</h2>
          </div>
          <div className="p-4">
            {Object.keys(filters).length === 0 ? (
              <p className="text-sm text-gray-500">No filters extracted</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(filters).map(([key, value]) => (
                  <span key={key} className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-sm font-medium rounded-full">
                    {key}: {String(value)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {fallback && (
            <div className="px-4 py-2 bg-yellow-50 border-t border-yellow-200">
              <p className="text-sm text-yellow-800 font-medium">Showing normal search results (fallback)</p>
            </div>
          )}

          {results.length > 0 && (
            <div className="p-4 border-t border-gray-200">
              <h3 className="font-medium text-gray-900 mb-3">Results ({results.length})</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {results.map((offer) => (
                  <div key={offer.offer_id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                    <h4 className="font-medium text-gray-900 truncate">
                      {offer.product_name ?? `Product ${offer.product_id?.slice(0, 8)}`}
                    </h4>
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
                        <span>{offer.dealer_city}, {offer.dealer_state}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{offer.effective_days ?? offer.bangalore_delivery_days ?? '—'} days</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                        <span>{offer.available_units ?? 0} units</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.length === 0 && !loading && messages.length > 0 && (
            <div className="p-4 border-t border-gray-200 text-center text-gray-500">
              No offers matched your query
            </div>
          )}
        </div>
      )}
    </div>
  )
}