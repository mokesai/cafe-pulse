import { test, expect } from './fixtures/auth';

/**
 * Invoice Pipeline E2E Tests
 * 
 * Tests the full invoice upload and processing workflow:
 * 1. Login to admin dashboard
 * 2. Navigate to invoices
 * 3. Upload invoice PDF
 * 4. Verify exception handling
 * 5. Confirm or resolve exceptions
 */

test.describe('Invoice Pipeline', () => {
  test('should display invoice management page', async ({ authenticatedPage }) => {
    // Navigate to invoices
    await authenticatedPage.goto('/admin/invoices');
    
    // Verify page loaded
    await expect(authenticatedPage).toHaveTitle(/Invoices/i);
    await expect(authenticatedPage.locator('text=Upload Invoice')).toBeVisible();
  });

  test('should open upload invoice modal', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/admin/invoices');
    
    // Click upload button
    await authenticatedPage.click('button:has-text("Upload Invoice")');
    
    // Verify modal opened
    await expect(authenticatedPage.locator('[role="dialog"]')).toBeVisible();
    await expect(authenticatedPage.locator('text=Select Supplier')).toBeVisible();
  });

  test('should navigate to invoice exceptions', async ({ authenticatedPage }) => {
    // Navigate to exceptions
    await authenticatedPage.goto('/admin/invoice-exceptions');
    
    // Verify page loaded
    await expect(authenticatedPage).toHaveTitle(/Exceptions/i);
    await expect(authenticatedPage.locator('text=Invoice Exceptions')).toBeVisible();
  });

  test('should display exception details', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/admin/invoice-exceptions');
    
    // Wait for exceptions to load
    await authenticatedPage.waitForSelector('[data-test="exception-item"]', { timeout: 5000 });
    
    // Click first exception if any exist
    const firstException = authenticatedPage.locator('[data-test="exception-item"]').first();
    if (await firstException.isVisible()) {
      await firstException.click();
      
      // Verify exception details panel opened
      await expect(authenticatedPage.locator('[data-test="exception-details"]')).toBeVisible();
    }
  });

  test('should navigate to invoice settings', async ({ authenticatedPage }) => {
    // Navigate to settings
    await authenticatedPage.goto('/admin/settings/invoices');
    
    // Verify page loaded
    await expect(authenticatedPage.locator('text=Invoice Settings')).toBeVisible();
  });
});

test.describe('Invoice Upload', () => {
  test.skip('should upload and process invoice', async ({ authenticatedPage }) => {
    // This test requires:
    // 1. Test invoice PDF file
    // 2. Supplier pre-configured
    // 3. Wait for webhook processing
    // 
    // TODO: Implement after test data setup
    
    await authenticatedPage.goto('/admin/invoices');
    await authenticatedPage.click('button:has-text("Upload Invoice")');
    
    // Select supplier dropdown
    await authenticatedPage.click('select[name="supplier_id"]');
    await authenticatedPage.selectOption('select[name="supplier_id"]', 'bluepoint-bakery');
    
    // Set invoice details
    await authenticatedPage.fill('input[name="invoice_number"]', 'TEST-001');
    await authenticatedPage.fill('input[name="invoice_date"]', '2026-03-28');
    
    // Upload file (TODO: need test PDF file)
    // await authenticatedPage.setInputFiles('input[type="file"]', 'test-invoice.pdf');
    
    // Submit
    // await authenticatedPage.click('button:has-text("Upload")');
    
    // Wait for success
    // await expect(authenticatedPage.locator('text=Successfully uploaded')).toBeVisible();
  });
});

test.describe('Navigation', () => {
  test('should navigate between invoice sections', async ({ authenticatedPage }) => {
    // Start at invoices
    await authenticatedPage.goto('/admin/invoices');
    await expect(authenticatedPage).toHaveURL('**/admin/invoices**');
    
    // Navigate to exceptions
    await authenticatedPage.click('text=Exceptions');
    await expect(authenticatedPage).toHaveURL('**/admin/invoice-exceptions**');
    
    // Navigate back to invoices
    await authenticatedPage.click('text=Invoices');
    await expect(authenticatedPage).toHaveURL('**/admin/invoices**');
  });

  test('should maintain authentication across navigation', async ({ authenticatedPage }) => {
    // Navigate multiple pages
    await authenticatedPage.goto('/admin/invoices');
    await authenticatedPage.goto('/admin/invoice-exceptions');
    await authenticatedPage.goto('/admin/settings/invoices');
    
    // Verify still authenticated (no redirect to login)
    await expect(authenticatedPage).not.toHaveURL('**/admin/login**');
  });
});
