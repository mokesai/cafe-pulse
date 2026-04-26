'use client'

import { useState, useCallback, useEffect } from 'react'
import { Upload, X, FileText, AlertCircle } from 'lucide-react'
import { Invoice } from '@/types/invoice'

interface Supplier {
  id: string
  name: string
  is_active: boolean
}

interface InvoiceUploadModalProps {
  isOpen: boolean
  onClose: () => void
  onUploadComplete?: (invoice?: Invoice) => void
  suppliers?: Supplier[]
  defaultSupplierId?: string
  lockSupplier?: boolean
  defaultInvoiceNumber?: string
  defaultInvoiceDate?: string
  purchaseOrderId?: string
}

export function InvoiceUploadModal({ 
  isOpen, 
  onClose, 
  onUploadComplete,
  suppliers = [],
  defaultSupplierId,
  lockSupplier = false,
  defaultInvoiceNumber = '',
  defaultInvoiceDate = '',
  purchaseOrderId
}: InvoiceUploadModalProps) {
  const [dragActive, setDragActive] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [formData, setFormData] = useState({
    supplier_id: '',
    invoice_number: '',
    invoice_date: ''
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setFormData(prev => ({
      supplier_id: defaultSupplierId || prev.supplier_id || '',
      invoice_number: defaultInvoiceNumber || prev.invoice_number || '',
      invoice_date: defaultInvoiceDate || prev.invoice_date || ''
    }))
  }, [isOpen, defaultSupplierId, defaultInvoiceNumber, defaultInvoiceDate])

  // Handle drag events
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  // Handle drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0]
      console.log('🗂️ File dropped:', droppedFile.name, droppedFile.type, droppedFile.size)
      setFile(droppedFile)
      setError(null)
    }
  }, [])

  // Handle file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0]
      console.log('📁 File selected:', selectedFile.name, selectedFile.type, selectedFile.size)
      setFile(selectedFile)
      setError(null)
    }
  }

  // Validate file
  const validateFile = (file: File): string | null => {
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    const maxSize = 10 * 1024 * 1024 // 10MB

    if (!allowedTypes.includes(file.type)) {
      return 'Please select a PDF or image file (PNG, JPG, WEBP)'
    }

    if (file.size > maxSize) {
      return 'File size must be less than 10MB'
    }

    return null
  }

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!file) {
      setError('Please select a file')
      return
    }

    if (!formData.invoice_number || !formData.invoice_date) {
      setError('Please fill in invoice number and date')
      return
    }

    if (!lockSupplier && !formData.supplier_id) {
      setError('Please select a supplier')
      return
    }

    const fileError = validateFile(file)
    if (fileError) {
      setError(fileError)
      return
    }

    try {
      setUploading(true)
      setError(null)

      console.log('📤 Uploading invoice:', {
        file: file.name,
        supplier: formData.supplier_id,
        invoice_number: formData.invoice_number,
        invoice_date: formData.invoice_date
      })

      // Create form data for upload.
      // MOK-120: purchase_order_id is now required by the upload route. The
      // route creates the manual order_invoice_matches link atomically, so
      // we no longer make a follow-up POST to link the PO.
      const uploadFormData = new FormData()
      uploadFormData.append('file', file)
      uploadFormData.append('supplier_id', formData.supplier_id)
      uploadFormData.append('invoice_number', formData.invoice_number)
      uploadFormData.append('invoice_date', formData.invoice_date)
      if (purchaseOrderId) {
        uploadFormData.append('purchase_order_id', purchaseOrderId)
      }

      const response = await fetch('/api/admin/invoices/upload', {
        method: 'POST',
        body: uploadFormData
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed')
      }

      console.log('✅ Upload successful:', result.data)

      setFile(null)
      setFormData({
        supplier_id: lockSupplier ? (defaultSupplierId || '') : '',
        invoice_number: defaultInvoiceNumber || '',
        invoice_date: defaultInvoiceDate || ''
      })

      if (typeof onUploadComplete === 'function') {
        onUploadComplete(result.data)
      }

      onClose()

    } catch (error: unknown) {
      console.error('Upload failed:', error)
      setError(error instanceof Error ? error.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  // Handle form input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    console.log('📝 Form input changed:', name, '=', value)
    setFormData(prev => {
      const newData = {
        ...prev,
        [name]: value
      }
      console.log('📝 Updated form data:', newData)
      return newData
    })
    setError(null)
  }

  // Reset form when modal closes
  const handleClose = () => {
    setFile(null)
    setFormData({
      supplier_id: defaultSupplierId || '',
      invoice_number: defaultInvoiceNumber || '',
      invoice_date: defaultInvoiceDate || ''
    })
    setError(null)
    setDragActive(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Upload Invoice</h2>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600"
              disabled={uploading}
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
          {/* File Upload Area */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Invoice File *
            </label>
            <div
              className={`relative border-2 border-dashed rounded-lg p-6 transition-colors ${
                dragActive 
                  ? 'border-indigo-500 bg-indigo-50' 
                  : file 
                    ? 'border-green-500 bg-green-50' 
                    : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <input
                type="file"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={handleFileChange}
                disabled={uploading}
              />
              
              <div className="text-center">
                {file ? (
                  <div className="flex items-center justify-center space-x-2">
                    <FileText className="w-8 h-8 text-green-600" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {Math.round(file.size / 1024)} KB • {file.type}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload className="mx-auto h-12 w-12 text-gray-400" />
                    <div className="mt-4">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        PDF, PNG, JPG up to 10MB
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Invoice Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Supplier Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Supplier {lockSupplier ? '' : <span className="text-gray-400">(Optional)</span>}
              </label>
              {lockSupplier ? (
                <div className="px-3 py-2 border border-gray-200 rounded-md bg-gray-100 text-sm text-gray-700">
                  {suppliers.find(supplier => supplier.id === (formData.supplier_id || defaultSupplierId))?.name || 'Current supplier'}
                </div>
              ) : (
                <select
                  name="supplier_id"
                  value={formData.supplier_id}
                  onChange={handleInputChange}
                  disabled={uploading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">Select existing supplier or leave blank...</option>
                  {suppliers
                    .filter(supplier => supplier.is_active)
                    .map(supplier => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                </select>
              )}
              {!lockSupplier && (
                <p className="text-xs text-gray-500 mt-1">
                  If left blank, we&rsquo;ll create a new supplier from the invoice information
                </p>
              )}
            </div>

            {/* Invoice Number */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Invoice Number *
              </label>
              <input
                type="text"
                name="invoice_number"
                value={formData.invoice_number}
                onChange={handleInputChange}
                disabled={uploading}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="INV-2024-001"
                required
              />
            </div>
          </div>

          {/* Invoice Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Invoice Date *
            </label>
            <input
              type="date"
              name="invoice_date"
              value={formData.invoice_date}
              onChange={handleInputChange}
              disabled={uploading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              required
            />
          </div>

          {/* Error Display */}
          {error && (
            <div className="flex items-center p-3 text-sm text-red-700 bg-red-100 rounded-md">
              <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={uploading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !file || !formData.invoice_number.trim() || !formData.invoice_date.trim()}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={`File: ${file ? '✓' : '✗'}, Invoice#: ${formData.invoice_number.trim() ? '✓' : '✗'}, Date: ${formData.invoice_date.trim() ? '✓' : '✗'}`}
            >
              {uploading ? (
                <>
                  <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Invoice
                </>
              )}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}
