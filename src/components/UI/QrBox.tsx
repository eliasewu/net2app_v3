import React, { useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check } from 'lucide-react';

interface Props {
  /** Text encoded in the QR code */
  payload: string;
  /** Shown under the QR — e.g. "Scan with Net2appPro" or "x-api-key header" */
  hint?: string;
  /** Size in px (default 200) */
  size?: number;
}

/**
 * Reusable QR display: renders a QR from any string payload with copy support.
 * Used for supplier gateway keys (Net2appPro pairing) and client API tokens.
 */
export const QrBox: React.FC<Props> = ({ payload, hint, size = 200 }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  React.useEffect(() => {
    if (!payload) { setDataUrl(null); return; }
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: size })
      .then(setDataUrl)
      .catch(() => setError(true));
  }, [payload, size]);

  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!payload || error) return null;

  return (
    <div className="inline-flex flex-col items-center gap-2 p-3 bg-white rounded-xl border border-gray-200">
      {dataUrl && <img src={dataUrl} alt="QR code" width={size} height={size} />}
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
        title="Copy to clipboard"
      >
        {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
        <span className="font-mono max-w-[220px] truncate">{payload.slice(0, 36)}{payload.length > 36 ? '…' : ''}</span>
      </button>
      {hint && <p className="text-xs text-gray-400 text-center">{hint}</p>}
    </div>
  );
};
