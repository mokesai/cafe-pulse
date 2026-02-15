'use client'

import { useState } from 'react'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

interface TestResult {
  success: boolean
  message?: string
  error?: string
  [key: string]: JsonValue | undefined
}

export default function TestPage() {
  const [supabaseTest, setSupabaseTest] = useState<TestResult | null>(null)
  const [catalogTest, setCatalogTest] = useState<TestResult | null>(null)
  const [databaseTest, setDatabaseTest] = useState<TestResult | null>(null)
  const [loading, setLoading] = useState(false)

  const testSupabase = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/test-supabase')
      const result = await response.json() as TestResult
      setSupabaseTest(result)
    } catch (error) {
      console.error('Supabase test failed:', error)
      setSupabaseTest({ success: false, error: 'Failed to test Supabase' })
    } finally {
      setLoading(false)
    }
  }

  const testCatalog = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/test-catalog')
      const result = await response.json() as TestResult
      setCatalogTest(result)
    } catch (error) {
      console.error('Catalog test failed:', error)
      setCatalogTest({ success: false, error: 'Failed to test Catalog' })
    } finally {
      setLoading(false)
    }
  }

  const testDatabase = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/test-database')
      const result = await response.json() as TestResult
      setDatabaseTest(result)
    } catch (error) {
      console.error('Database test failed:', error)
      setDatabaseTest({ success: false, error: 'Failed to test Database' })
    } finally {
      setLoading(false)
    }
  }

  const runAllTests = async () => {
    await testSupabase()
    await testCatalog()
    await testDatabase()
  }

  return (
    <div className="min-h-screen bg-gray-50 py-20">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Integration Tests</h1>
        
        <div className="mb-6">
          <button
            onClick={runAllTests}
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold"
          >
            {loading ? 'Running Tests...' : 'Run All Tests'}
          </button>
        </div>
        
        <div className="grid md:grid-cols-2 gap-8">
          {/* Supabase Test */}
          <div className="bg-white rounded-lg p-6 shadow-md">
            <h2 className="text-xl font-semibold mb-4">Supabase Test</h2>
            <button
              onClick={testSupabase}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Testing...' : 'Test Supabase Connection'}
            </button>
            
            {supabaseTest && (
              <div className="mt-4 p-4 rounded bg-gray-50">
                <div className={`font-semibold ${supabaseTest.success ? 'text-green-600' : 'text-red-600'}`}>
                  {supabaseTest.success ? '✅ Success' : '❌ Failed'}
                </div>
                <div className="text-sm text-gray-600 mt-2">
                  {supabaseTest.message}
                </div>
                {supabaseTest.sessionInfo && typeof supabaseTest.sessionInfo === 'object' && 'email' in supabaseTest.sessionInfo && (
                  <div className="text-sm text-gray-600 mt-2">
                    User: {(supabaseTest.sessionInfo as { email?: string }).email || 'Unknown'}
                  </div>
                )}
                {supabaseTest.error && (
                  <div className="text-sm text-red-600 mt-2">
                    Error: {supabaseTest.error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Catalog Test */}
          <div className="bg-white rounded-lg p-6 shadow-md">
            <h2 className="text-xl font-semibold mb-4">Square Catalog Test</h2>
            <button
              onClick={testCatalog}
              disabled={loading}
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? 'Testing...' : 'Test Catalog API'}
            </button>

            {catalogTest && (
              <div className="mt-4 p-4 rounded bg-gray-50">
                <div className={`font-semibold ${catalogTest.success ? 'text-green-600' : 'text-red-600'}`}>
                  {catalogTest.success ? '✅ Success' : '❌ Failed'}
                </div>
                <div className="text-sm text-gray-600 mt-2">
                  {catalogTest.message}
                </div>
                {typeof catalogTest.categoriesCount === 'number' && (
                  <div className="text-sm text-gray-600 mt-2">
                    Categories found: {catalogTest.categoriesCount}
                  </div>
                )}
                {catalogTest.error && (
                  <div className="text-sm text-red-600 mt-2">
                    Error: {catalogTest.error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Database Test */}
          <div className="bg-white rounded-lg p-6 shadow-md">
            <h2 className="text-xl font-semibold mb-4">Database Test</h2>
            <button
              onClick={testDatabase}
              disabled={loading}
              className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Testing...' : 'Test Database Schema'}
            </button>
            
            {databaseTest && (
              <div className="mt-4 p-4 rounded bg-gray-50">
                <div className={`font-semibold ${databaseTest.success ? 'text-green-600' : 'text-red-600'}`}>
                  {databaseTest.success ? '✅ Success' : '❌ Failed'}
                </div>
                <div className="text-sm text-gray-600 mt-2">
                  {databaseTest.message}
                </div>
                {databaseTest.tables && (
                  <div className="text-sm text-gray-600 mt-2">
                    <div>Tables: {Object.entries(databaseTest.tables).map(([table, status]) => 
                      `${table}: ${status}`
                    ).join(', ')}</div>
                  </div>
                )}
                {databaseTest.setup_required && (
                  <div className="text-sm text-amber-600 mt-2 font-medium">
                    ⚠️ Database setup required - run migrations in Supabase
                  </div>
                )}
                {databaseTest.error && (
                  <div className="text-sm text-red-600 mt-2">
                    Error: {databaseTest.error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 p-4 bg-blue-50 rounded-lg">
          <h3 className="font-semibold text-blue-900 mb-2">Phase 2 Status:</h3>
          <div className="text-blue-800 space-y-2">
            <div>✅ Database schema created</div>
            <div>✅ Row Level Security (RLS) policies set up</div>
            <div>✅ Authentication UI components built</div>
            <div>✅ Navigation integration complete</div>
            <div>✅ User profile management created</div>
            <div className="mt-4 p-3 bg-blue-100 rounded">
              <strong>Setup Required:</strong> Run database migrations in your Supabase dashboard, then test authentication flow
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
