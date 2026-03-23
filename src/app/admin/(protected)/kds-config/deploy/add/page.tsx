'use client'

import { useState, useEffect, useTransition } from 'react'
import { useTenant } from '@/providers/TenantProvider'
import { createDevice, getDeviceStatus } from '../deploy-actions'
import {
  ArrowLeft, ArrowRight, Tv, HardDrive, Terminal, BookOpen,
  Loader2, CheckCircle, Copy, Check, Wifi,
} from 'lucide-react'
import Link from 'next/link'

type Step = 1 | 2 | 3 | 4
type SetupMethod = 'sd-image' | 'script' | 'manual'

export default function AddDevicePage() {
  const tenant = useTenant()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState<Step>(1)
  const [error, setError] = useState<string | null>(null)

  // Step 1
  const [name, setName] = useState('')

  // Step 2
  const [screen1, setScreen1] = useState('drinks')
  const [screen2, setScreen2] = useState('food')

  // Step 3
  const [method, setMethod] = useState<SetupMethod>('sd-image')
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiPassword, setWifiPassword] = useState('')

  // Step 4 (after device created)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [setupCode, setSetupCode] = useState<string | null>(null)
  const [registered, setRegistered] = useState(false)
  const [copied, setCopied] = useState(false)

  const selectCls = 'w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none'
  const inputCls = 'w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none'

  // Default name suggestion
  useEffect(() => {
    if (tenant?.name && !name) {
      setName(`${tenant.name} Pi`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.name])

  function handleCreateDevice() {
    if (!tenant?.id || !name.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await createDevice(tenant.id, name.trim(), screen1, screen2)
      if (result.success) {
        setDeviceId(result.device.id)
        setSetupCode(result.device.setup_code)
        setStep(4)
      } else {
        setError(result.error)
      }
    })
  }

  // Poll for registration in Step 4
  useEffect(() => {
    if (step !== 4 || !deviceId || !tenant?.id || registered) return

    const interval = setInterval(async () => {
      const status = await getDeviceStatus(deviceId, tenant.id)
      if (status?.status === 'registered') {
        setRegistered(true)
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [step, deviceId, tenant?.id, registered])

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://cafepulse.com'
  const curlCommand = setupCode
    ? `curl -sL ${appUrl}/api/kds/setup/${setupCode} | bash`
    : ''

  return (
    <div className="p-8 max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/kds-config/deploy" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Device Manager
        </Link>
        <div className="flex items-center gap-3">
          <Tv className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold text-white">Add Device</h1>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              s < step ? 'bg-green-600 text-white' :
              s === step ? 'bg-blue-600 text-white' :
              'bg-gray-700 text-gray-400'
            }`}>
              {s < step ? <Check className="w-3.5 h-3.5" /> : s}
            </div>
            {s < 4 && <div className={`w-8 h-0.5 ${s < step ? 'bg-green-600' : 'bg-gray-700'}`} />}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg mb-4">
          <span className="text-sm text-red-300">{error}</span>
        </div>
      )}

      {/* ── Step 1: Name ── */}
      {step === 1 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Name your device</h2>
          <p className="text-sm text-gray-400">Give your Raspberry Pi a recognizable name.</p>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., Front Counter Pi"
            className={inputCls}
            autoFocus
          />
          <div className="flex justify-end">
            <button
              onClick={() => name.trim() && setStep(2)}
              disabled={!name.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Assign Screens ── */}
      {step === 2 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Assign screens</h2>
          <p className="text-sm text-gray-400">Choose which KDS screen to display on each HDMI output.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">HDMI 1</label>
              <select value={screen1} onChange={e => setScreen1(e.target.value)} className={selectCls}>
                <option value="drinks">Drinks</option>
                <option value="food">Food</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">HDMI 2</label>
              <select value={screen2} onChange={e => setScreen2(e.target.value)} className={selectCls}>
                <option value="drinks">Drinks</option>
                <option value="food">Food</option>
              </select>
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-4 py-2 bg-gray-700 text-gray-300 text-sm rounded-lg hover:bg-gray-600 transition-colors">
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Setup Method ── */}
      {step === 3 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Choose setup method</h2>
          <p className="text-sm text-gray-400">How would you like to set up your Raspberry Pi?</p>

          <div className="space-y-3">
            {/* SD Card Image */}
            <button
              onClick={() => setMethod('sd-image')}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                method === 'sd-image' ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 bg-gray-750 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center gap-3">
                <HardDrive className={`w-5 h-5 ${method === 'sd-image' ? 'text-blue-400' : 'text-gray-400'}`} />
                <div>
                  <p className="text-sm font-medium text-white">SD Card Image <span className="text-xs text-blue-400 ml-1">Recommended</span></p>
                  <p className="text-xs text-gray-400 mt-0.5">Download a ready-to-flash image. Flash, insert, power on.</p>
                </div>
              </div>
            </button>

            {/* Setup Script */}
            <button
              onClick={() => setMethod('script')}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                method === 'script' ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 bg-gray-750 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center gap-3">
                <Terminal className={`w-5 h-5 ${method === 'script' ? 'text-blue-400' : 'text-gray-400'}`} />
                <div>
                  <p className="text-sm font-medium text-white">Setup Script</p>
                  <p className="text-xs text-gray-400 mt-0.5">Already have Raspberry Pi OS? Run one command.</p>
                </div>
              </div>
            </button>

            {/* Manual */}
            <button
              onClick={() => setMethod('manual')}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                method === 'manual' ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 bg-gray-750 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center gap-3">
                <BookOpen className={`w-5 h-5 ${method === 'manual' ? 'text-blue-400' : 'text-gray-400'}`} />
                <div>
                  <p className="text-sm font-medium text-white">Manual Setup</p>
                  <p className="text-xs text-gray-400 mt-0.5">Step-by-step instructions with copy-paste commands.</p>
                </div>
              </div>
            </button>
          </div>

          {/* WiFi config for SD Image */}
          {method === 'sd-image' && (
            <div className="p-4 bg-gray-750 rounded-lg border border-gray-600 space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Wifi className="w-4 h-4" />
                WiFi Configuration
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Network Name (SSID)</label>
                <input type="text" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)} className={inputCls} placeholder="CafeWiFi" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Password</label>
                <input type="password" value={wifiPassword} onChange={e => setWifiPassword(e.target.value)} className={inputCls} placeholder="WiFi password" />
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-4 py-2 bg-gray-700 text-gray-300 text-sm rounded-lg hover:bg-gray-600 transition-colors">
              Back
            </button>
            <button
              onClick={handleCreateDevice}
              disabled={isPending || (method === 'sd-image' && (!wifiSsid.trim() || !wifiPassword.trim()))}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : <>Create Device</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Waiting for Registration ── */}
      {step === 4 && setupCode && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 space-y-5">
          {registered ? (
            /* Success */
            <div className="text-center space-y-4">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto" />
              <h2 className="text-lg font-semibold text-white">Device Connected!</h2>
              <p className="text-sm text-gray-400">
                <span className="text-white font-medium">{name}</span> is now registered and displaying your KDS screens.
              </p>
              <Link
                href="/admin/kds-config/deploy"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                View Device Manager
              </Link>
            </div>
          ) : (
            /* Waiting */
            <>
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-3" />
                <h2 className="text-lg font-semibold text-white">Waiting for your Pi to connect...</h2>
                <p className="text-sm text-gray-400 mt-1">Follow the instructions below, then your Pi will register automatically.</p>
              </div>

              {/* Setup Code */}
              <div className="p-4 bg-gray-900 rounded-lg border border-gray-600 text-center">
                <p className="text-xs text-gray-400 mb-2">Setup Code</p>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-3xl font-mono font-bold text-white tracking-widest">{setupCode}</span>
                  <button
                    onClick={() => copyToClipboard(setupCode)}
                    className="p-2 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
                    title="Copy"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">Expires in 24 hours</p>
              </div>

              {/* Method-specific instructions */}
              {method === 'sd-image' && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">Next Steps:</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
                    <li>Download the SD card image (button below — ~2 GB)</li>
                    <li>Flash the image to an SD card using <a href="https://www.raspberrypi.com/software/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">Raspberry Pi Imager</a> or balenaEtcher</li>
                    <li>Insert the SD card into your Raspberry Pi</li>
                    <li>Connect the Pi to your TV(s) via HDMI</li>
                    <li>Power on — the Pi will auto-register and display your KDS screens</li>
                  </ol>
                  <button
                    disabled
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-gray-700 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed"
                  >
                    <HardDrive className="w-4 h-4" />
                    Download SD Card Image (coming in Phase 3)
                  </button>
                </div>
              )}

              {method === 'script' && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">Run this command on your Pi:</h3>
                  <div className="flex items-center gap-2 p-3 bg-gray-900 rounded-lg border border-gray-600 font-mono text-sm">
                    <code className="flex-1 text-green-400 break-all">{curlCommand}</code>
                    <button
                      onClick={() => copyToClipboard(curlCommand)}
                      className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 flex-shrink-0"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">Requires Raspberry Pi OS with SSH access.</p>
                </div>
              )}

              {method === 'manual' && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-white">Manual Setup Steps:</h3>
                  <ol className="list-decimal list-inside space-y-3 text-sm text-gray-300">
                    <li>
                      Install Raspberry Pi OS Lite (64-bit) and connect via SSH
                    </li>
                    <li>
                      Install required packages:
                      <div className="mt-1 p-2 bg-gray-900 rounded border border-gray-600 font-mono text-xs text-green-400">
                        sudo apt update && sudo apt install -y chromium-browser xserver-xorg xinit x11-xserver-utils unclutter jq
                      </div>
                    </li>
                    <li>
                      Register your device:
                      <div className="mt-1 p-2 bg-gray-900 rounded border border-gray-600 font-mono text-xs text-green-400 break-all">
                        {`curl -s -X POST ${appUrl}/api/kds/register -H "Content-Type: application/json" -d '{"setup_code":"${setupCode}"}' > ~/kds-config.json`}
                      </div>
                    </li>
                    <li>
                      Download the kiosk script:
                      <div className="mt-1 p-2 bg-gray-900 rounded border border-gray-600 font-mono text-xs text-green-400 break-all">
                        {`curl -sL ${appUrl}/api/kds/kiosk-script > ~/kds-kiosk.sh && chmod +x ~/kds-kiosk.sh`}
                      </div>
                    </li>
                    <li>
                      Configure autostart:
                      <div className="mt-1 p-2 bg-gray-900 rounded border border-gray-600 font-mono text-xs text-green-400">
                        {`echo '[[ -z $DISPLAY && $XDG_VTNR -eq 1 ]] && startx ~/kds-kiosk.sh' >> ~/.bash_profile`}
                      </div>
                    </li>
                    <li>Reboot: <code className="text-green-400">sudo reboot</code></li>
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
