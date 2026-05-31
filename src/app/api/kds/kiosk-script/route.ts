import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * GET /api/kds/kiosk-script?type=kiosk|register|sway-config|greetd-config
 *
 * Serves Pi-side artifacts that the curl-bash setup script drops onto the
 * Pi. Phase 8 (MOK-49/50) added sway-config (the compositor config) and
 * greetd-config (the display-manager config that launches sway with a
 * proper PAM session) on top of the original kiosk + register pair.
 */
const TYPE_TO_FILENAME: Record<string, string> = {
  kiosk: 'kds-kiosk.sh',
  register: 'kds-register.sh',
  'sway-config': 'sway-config',
  'greetd-config': 'greetd-config.toml',
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type') ?? 'kiosk'
  const filename = TYPE_TO_FILENAME[type]

  if (!filename) {
    return new NextResponse(
      `echo "Error: Unknown kiosk-script type '${type}'"\nexit 1\n`,
      { status: 400, headers: { 'Content-Type': 'text/plain' } },
    )
  }

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
