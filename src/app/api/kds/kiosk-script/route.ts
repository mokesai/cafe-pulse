import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * GET /api/kds/kiosk-script?type=kiosk|register
 * Serves Pi-side shell scripts for the KDS kiosk setup.
 */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') ?? 'kiosk'

  const filename = type === 'register' ? 'kds-register.sh' : 'kds-kiosk.sh'
  const scriptPath = join(process.cwd(), 'scripts', 'pi', filename)

  try {
    const content = readFileSync(scriptPath, 'utf-8')
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return new NextResponse(`echo "Error: Script ${filename} not found"\nexit 1\n`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}
