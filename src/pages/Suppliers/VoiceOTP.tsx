import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Plus, Search, Edit, Trash2, Play, Pause, Globe, Phone, Settings, Save, CheckCircle, XCircle, Upload, SkipForward, Download, RefreshCw } from 'lucide-react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input } from '../../components/UI/Input';
import { Table } from '../../components/UI/Table';
import { voiceOtpApi } from '../../services/api';
import type { VoiceOTPConfig, VoiceOTPLog, SipServer } from '../../types';

// ──────────────────────── helpers ────────────────────────

const statusBadge = (s: string, dlr?: string | null) => {
  const cls = dlr === 'DELIVRD' || s === 'completed' ? 'success'
    : s === 'failed' || s === 'busy' || s === 'no_answer' ? 'danger'
    : s === 'ringing' || s === 'answered' || s === 'initiated' ? 'warning'
    : 'info';
  return <Badge variant={cls as any} size="sm">{s}{dlr && dlr !== s ? ` / ${dlr}` : ''}</Badge>;
};

const emptyForm = {
  language: '', language_code: 'en', country_prefix: '',
  greeting_text: '', retry_text: '',
  is_active: true,
  primary_language_code: 'en', secondary_language_code: 'en',
  retry_count: 4, play_count: 1,
};

// ──────────────────────── main component ────────────────────────

export const VoiceOTP: React.FC = () => {
  const [tab, setTab] = useState<'language' | 'audio' | 'sip' | 'logs'>('language');

  // -- shared data --
  const [configs, setConfigs] = useState<VoiceOTPConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await voiceOtpApi.getConfigs();
      const arr = res.success && res.data?.data ? res.data.data
        : res.success && Array.isArray(res.data) ? res.data : [];
      setConfigs(arr);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  // ──────────── Language tab (CRUD) ────────────

  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<VoiceOTPConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);

  const filtered = configs.filter((s: any) =>
    (s.language || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.country_prefix || '').includes(search)
  );

  const openAdd = () => { setEditing(null); setError(''); setForm(emptyForm); setShowModal(true); };
  const openEdit = (s: VoiceOTPConfig) => {
    setEditing(s); setError('');
    setForm({
      language: s.language || '', language_code: s.language_code || 'en',
      country_prefix: s.country_prefix || '', greeting_text: s.greeting_text || '',
      retry_text: s.retry_text || '',
      is_active: s.is_active !== false,
      primary_language_code: s.primary_language_code || 'en',
      secondary_language_code: s.secondary_language_code || 'en',
      retry_count: s.retry_count || 4,
      play_count: s.play_count || 1,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setError(''); setSaving(true);
    try {
      if (editing) await voiceOtpApi.updateConfig(String(editing.id), form);
      else await voiceOtpApi.createConfig(form);
      setShowModal(false);
      await loadConfigs();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const handleDelete = async (id: string | number) => {
    if (!window.confirm('Delete this configuration?')) return;
    try { await voiceOtpApi.deleteConfig(String(id)); await loadConfigs(); } catch (e: any) { alert(e.message); }
  };

  const handleToggle = async (s: VoiceOTPConfig) => {
    try { await voiceOtpApi.updateConfig(String(s.id), { is_active: !s.is_active }); await loadConfigs(); } catch (e: any) { alert(e.message); }
  };

  // ──────────── Audio tab ────────────

  const [uploadTarget, setUploadTarget] = useState<VoiceOTPConfig | null>(null);
  const [audioLayer, setAudioLayer] = useState<'primary' | 'secondary'>('primary');
  const [uploading, setUploading] = useState(false);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const digitUploadRef = useRef<string | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [dragOverDigit, setDragOverDigit] = useState<string | null>(null);
  const dragCounterRef = useRef<Record<string, number>>({});

  // cleanup audio on unmount
  useEffect(() => { return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } }; }, []);

  // helper to parse audio JSONB for status table (defined once, not per-row)
  const parseAudioJson = (raw: any) => {
    if (!raw) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  };

  // audio map: picks primary or secondary column, with fallback
  const audioMap = useMemo(() => {
    if (!uploadTarget) return {};
    const key = audioLayer === 'primary' ? 'audio_0_9_primary' : 'audio_0_9_secondary';
    const raw = (uploadTarget as any)[key];
    if (!raw) {
      // fallback: if secondary is empty, reuse primary
      if (audioLayer === 'secondary') {
        const pri = (uploadTarget as any).audio_0_9_primary || uploadTarget.audio_0_9;
        if (pri) return typeof pri === 'string' ? JSON.parse(pri) : pri;
      }
      // for primary, try legacy audio_0_9
      const legacy = uploadTarget.audio_0_9;
      if (legacy) return typeof legacy === 'string' ? JSON.parse(legacy) : legacy;
      return {};
    }
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }, [uploadTarget?.id, (uploadTarget as any)?.audio_0_9_primary, (uploadTarget as any)?.audio_0_9_secondary, uploadTarget?.audio_0_9, audioLayer]);

  const hasDigitAudio = (digit: string) => !!(audioMap && audioMap[digit]);
  const getDigitAudioUrl = (digit: string): string | null => (audioMap && audioMap[digit]) || null;
  const digitCount = Object.keys(audioMap).length;

  // whether secondary is reusing primary
  const isReusingPrimary = audioLayer === 'secondary' && !(uploadTarget as any)?.audio_0_9_secondary
    && !!((uploadTarget as any)?.audio_0_9_primary || uploadTarget?.audio_0_9);

  const playAudio = (url: string, key: string) => {
    if (playingKey === key) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingKey(null);
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    const a = new Audio(url);
    a.onended = () => { audioRef.current = null; setPlayingKey(null); };
    a.onerror = () => { audioRef.current = null; setPlayingKey(null); };
    a.play().catch(() => {});
    audioRef.current = a;
    setPlayingKey(key);
  };

  const uploadFileForDigit = async (file: File, digit: string) => {
    if (!uploadTarget) return;
    const fd = new FormData();
    fd.append('audio', file);
    fd.append('field', 'digit');
    fd.append('digit', digit);
    fd.append('layer', audioLayer);
    await voiceOtpApi.uploadAudio(String(uploadTarget.id), fd);
    await loadConfigs();
    // refresh the upload target
    const res: any = await voiceOtpApi.getConfigs();
    const arr = res.success && res.data?.data ? res.data.data
      : res.success && Array.isArray(res.data) ? res.data : [];
    const found = arr.find((c: any) => String(c.id) === String(uploadTarget.id));
    if (found) setUploadTarget(found);
  };

  const handleDigitFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const digit = digitUploadRef.current;
    if (!file || !uploadTarget || !digit) return;
    setUploading(true);
    try { await uploadFileForDigit(file, digit); }
    catch (err: any) { alert(err.message); }
    setUploading(false);
    digitUploadRef.current = null;
  };

  const handleGreetingUpload = async (field: 'greeting' | 'secondary_greeting') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mp3,audio/wav,audio/mpeg,audio/x-wav';
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file || !uploadTarget) return;
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append('audio', file);
        fd.append('field', field);
        await voiceOtpApi.uploadAudio(String(uploadTarget.id), fd);
        await loadConfigs();
        const res: any = await voiceOtpApi.getConfigs();
        const arr = res.success && res.data?.data ? res.data.data
          : res.success && Array.isArray(res.data) ? res.data : [];
        const found = arr.find((c: any) => String(c.id) === String(uploadTarget.id));
        if (found) setUploadTarget(found);
      } catch (err: any) { alert(err.message); }
      setUploading(false);
      input.remove();
    };
    input.click();
  };

  const triggerDigitUpload = (digit: string) => {
    digitUploadRef.current = digit;
    const input = document.getElementById('digit-file-input') as HTMLInputElement | null;
    if (input) { input.value = ''; input.click(); }
  };

  // Drag-and-drop handlers for digit cards
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDragEnter = (e: React.DragEvent, digit: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current[digit] = (dragCounterRef.current[digit] || 0) + 1;
    setDragOverDigit(digit);
  };
  const handleDragLeave = (e: React.DragEvent, digit: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current[digit] = (dragCounterRef.current[digit] || 1) - 1;
    if (dragCounterRef.current[digit] <= 0) {
      dragCounterRef.current[digit] = 0;
      setDragOverDigit(null);
    }
  };
  const handleDigitDrop = async (e: React.DragEvent, digit: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current[digit] = 0;
    setDragOverDigit(null);
    const file = e.dataTransfer.files?.[0];
    if (!file || !uploadTarget) return;
    if (!file.type.startsWith('audio/')) return;
    e.dataTransfer.clearData();
    setUploading(true);
    try { await uploadFileForDigit(file, digit); }
    catch (err: any) { alert(err.message); }
    setUploading(false);
  };

  // Play all digits 0-9 in sequence
  const playAllDigits = () => {
    if (playingAll) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setPlayingAll(false);
      setPlayingKey(null);
      return;
    }
    setPlayingAll(true);
    let idx = 0;
    const playNext = () => {
      if (idx > 9) { setPlayingAll(false); setPlayingKey(null); return; }
      const url = getDigitAudioUrl(String(idx));
      if (!url) { idx++; playNext(); return; }
      const a = new Audio(url);
      audioRef.current = a;
      setPlayingKey(String(idx));
      a.onended = () => { idx++; playNext(); };
      a.onerror = () => { idx++; playNext(); };
      a.play().catch(() => { idx++; playNext(); });
    };
    playNext();
  };
  // Download all digits + greetings as ZIP
  const handleDownloadZip = async () => {
    if (!uploadTarget) return;
    setDownloadingZip(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const lang = uploadTarget.language || uploadTarget.country_prefix || 'group';
      const layer = audioLayer === 'primary'
        ? `1st_${uploadTarget.primary_language_code || 'en'}`
        : `2nd_${uploadTarget.secondary_language_code || 'en'}`;
      const folderName = `${lang}_${layer}`;
      const folder = zip.folder(folderName);

      const addFile = (dataUrl: string | null, filename: string) => {
        if (!dataUrl) return;
        const parts = dataUrl.split(',');
        if (parts.length < 2) return;
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'audio/wav';
        const ext = mime.includes('mpeg') || mime.includes('mp3') ? '.mp3' : '.wav';
        const binary = atob(parts[1]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        folder!.file(filename + ext, bytes);
      };

      // greetings
      addFile(uploadTarget.greeting_audio_url, `greeting_${uploadTarget.primary_language_code || 'en'}`);
      addFile(uploadTarget.secondary_greeting_audio_url, `greeting_${uploadTarget.secondary_language_code || 'en'}`);

      // digits 0-9
      for (let d = 0; d <= 9; d++) {
        const url = getDigitAudioUrl(String(d));
        addFile(url, String(d));
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${folderName}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) { alert('ZIP generation failed: ' + e.message); }
    setDownloadingZip(false);
  };

  // ──────────── SIP Config tab (multi-server) ────────────

  const emptySipServer: SipServer = { name: '', host: '', port: 5060, username: '', password: '', caller_id: '', codec: 'g729', is_e164: false, mccmnc_allowed: '' };
  const [sipServers, setSipServers] = useState<SipServer[]>([]);
  const [sipLoading, setSipLoading] = useState(false);
  const [sipSaving, setSipSaving] = useState(false);
  const [sipForm, setSipForm] = useState<SipServer>(emptySipServer);
  const [sipFormIdx, setSipFormIdx] = useState<number | null>(null);
  const [showSipForm, setShowSipForm] = useState(false);

  const loadSipServers = async () => {
    setSipLoading(true);
    try {
      const res: any = await voiceOtpApi.getSipServers();
      if (res.success && res.data) {
        const servers = res.data?.servers || [];
        setSipServers(Array.isArray(servers) ? servers : []);
      }
    } catch { /* silent */ }
    setSipLoading(false);
  };

  useEffect(() => { if (tab === 'sip') loadSipServers(); }, [tab]);

  const saveSipServers = async () => {
    setSipSaving(true);
    try { await voiceOtpApi.updateSipServers({ servers: sipServers }); alert('SIP servers saved.'); }
    catch (e: any) { alert(e.message); }
    setSipSaving(false);
  };

  const openSipAdd = () => { setSipForm(emptySipServer); setSipFormIdx(null); setShowSipForm(true); };
  const openSipEdit = (idx: number) => { setSipForm({ ...sipServers[idx] }); setSipFormIdx(idx); setShowSipForm(true); };
  const handleSipFormSave = () => {
    if (!sipForm.host.trim()) { alert('SIP Host is required.'); return; }
    if (sipFormIdx !== null) {
      const updated = [...sipServers];
      updated[sipFormIdx] = { ...sipForm, id: sipForm.id || `srv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` };
      setSipServers(updated);
    } else {
      setSipServers([...sipServers, { ...sipForm, id: `srv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` }]);
    }
    setShowSipForm(false);
  };
  const handleSipDelete = (idx: number) => {
    if (!window.confirm('Remove this SIP server?')) return;
    setSipServers(sipServers.filter((_, i) => i !== idx));
  };

  // ──────────── Call Logs tab ────────────

  const [logs, setLogs] = useState<VoiceOTPLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logFilter, setLogFilter] = useState({ status: '', destination: '', limit: 200 });

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res: any = await voiceOtpApi.getLogs(logFilter);
      const arr = res.success && res.data?.data ? res.data.data
        : res.success && Array.isArray(res.data) ? res.data : [];
      setLogs(arr);
    } catch { /* silent */ }
    setLogsLoading(false);
  }, [logFilter]);

  useEffect(() => { if (tab === 'logs') loadLogs(); }, [tab, loadLogs]);

  // ──────────── table columns ────────────

  const langColumns = [
    { key: 'language', header: 'Language / Group', render: (s: any) => <div><p className="font-medium text-sm">{s.language || 'Unnamed'}</p><p className="text-[10px] text-gray-500">{s.country_prefix ? '+' + s.country_prefix.replace(/,/g, ', +') : ''} • 1st:{s.primary_language_code || 'en'} {s.secondary_language_code ? '/ 2nd:' + s.secondary_language_code : ''}</p></div> },
    { key: 'playback', header: 'Playback', render: (s: any) => <div className="text-xs"><span className="font-medium">{s.play_count || 1}x</span><span className="text-gray-400"> · </span><span>Rtry: {s.retry_count || 4}</span></div> },
    { key: 'status', header: 'Status', render: (s: any) => <Badge variant={s.is_active ? 'success' : 'danger'} dot size="sm">{s.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'actions', header: 'Actions', render: (s: any) => <div className="flex gap-0.5">
      <button onClick={() => openEdit(s)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500" /></button>
      <button onClick={() => handleToggle(s)} className="p-1 rounded hover:bg-gray-100">{s.is_active ? <XCircle size={14} className="text-red-500" /> : <CheckCircle size={14} className="text-green-500" />}</button>
      <button onClick={() => handleDelete(s.id)} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500" /></button>
    </div> },
  ];

  const logColumns = [
    { key: 'call_id', header: 'Call ID', render: (l: any) => <span className="font-mono text-xs">{l.call_id?.slice(-12) || '-'}</span> },
    { key: 'destination', header: 'Destination', render: (l: any) => <span className="text-sm">{l.destination || '-'}</span> },
    { key: 'otp', header: 'OTP', render: (l: any) => <span className="font-mono text-sm font-semibold">{l.otp_code || '-'}</span> },
    { key: 'language', header: 'Lang', render: (l: any) => <span className="text-xs">{l.language || '-'}</span> },
    { key: 'duration', header: 'Dur', render: (l: any) => <span className="text-xs">{l.duration || 0}s</span> },
    { key: 'status', header: 'Status', render: (l: any) => statusBadge(l.status, l.dlr_status) },
    { key: 'retry', header: 'Retry', render: (l: any) => <span className="text-xs">{l.retry_count || 0}/{l.max_retries || 3}</span> },
    { key: 'time', header: 'Time', render: (l: any) => <span className="text-xs text-gray-500">{l.created_at ? new Date(l.created_at).toLocaleString() : '-'}</span> },
    { key: 'retryBtn', header: '', render: (l: any) => l.status === 'failed' ? <button onClick={async () => { try { await voiceOtpApi.retryCall(l.call_id); loadLogs(); } catch (e: any) { alert(e.message); } }} className="text-orange-500 hover:underline text-xs"><RefreshCw size={12} /></button> : null },
  ];

  // ──────────── loading & render ────────────

  if (loading) return <div className="p-8 text-center text-gray-500">Loading configurations...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-800">Voice OTP</h1><p className="text-gray-500 mt-1">{configs.length} configurations loaded</p></div>
        {tab === 'language' && <Button icon={<Plus size={18} />} onClick={openAdd}>Add Configuration</Button>}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-0">
        {(['language', 'audio', 'sip', 'logs'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ' +
              (tab === t ? 'border-purple-600 text-purple-700 bg-purple-50/50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')}>
            {t === 'language' ? 'Language Configs' : t === 'audio' ? 'Audio' : t === 'sip' ? 'SIP Config' : 'Call Logs'}
          </button>
        ))}
      </div>

      {/* ────── LANGUAGE TAB ────── */}
      {tab === 'language' && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><Phone size={20} className="text-purple-500 mb-1" /><p className="text-xl font-bold">{configs.length}</p><p className="text-xs text-gray-500">Total</p></Card>
          <Card><CheckCircle size={20} className="text-green-500 mb-1" /><p className="text-xl font-bold">{configs.filter((s:any) => s.is_active).length}</p><p className="text-xs text-gray-500">Active</p></Card>
          <Card><Globe size={20} className="text-blue-500 mb-1" /><p className="text-xl font-bold">{new Set(configs.map((s:any) => s.language_code)).size}</p><p className="text-xs text-gray-500">Languages</p></Card>
          <Card><Settings size={20} className="text-orange-500 mb-1" /><p className="text-xl font-bold">{new Set(configs.map((s:any) => s.country_prefix)).size}</p><p className="text-xs text-gray-500">Prefixes</p></Card>
        </div>
        <Card><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input type="text" placeholder="Search by language or prefix..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm" /></div></Card>
        <Card noPadding><Table columns={langColumns} data={filtered} keyExtractor={(s: any) => String(s.id)} /></Card>
      </>}

      {/* ────── AUDIO TAB ────── */}
      {tab === 'audio' && <div className="space-y-5">
        {/* Gradient info banner */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-500 text-white rounded-xl p-4 flex items-center gap-3">
          <Upload size={24} className="opacity-80" />
          <div>
            <p className="font-semibold">Audio Management & Upload Dashboard</p>
            <p className="text-sm text-purple-100">Upload mp3 or wav files for greeting and each digit (0-9). Files are auto-converted to 8kHz mono wav for telecom transmission. Selected group: <strong>{uploadTarget ? (uploadTarget.language || uploadTarget.country_prefix || 'Unknown') : 'None'}</strong></p>
          </div>
        </div>

        {/* Language selector + layer toggle */}
        <div className="flex flex-wrap items-end gap-4">
          <Card noPadding className="flex-1 min-w-[260px]">
            <div className="p-4">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Target Country / Language Group</label>
              <select value={uploadTarget?.id || ''} onChange={e => {
                const found = configs.find(c => String(c.id) === e.target.value);
                setUploadTarget(found || null);
                setAudioLayer('primary');
              }} className="mt-1 block w-full rounded-lg border-gray-300 text-sm py-2 px-3 bg-white">
                <option value="">-- Select a language group --</option>
                {configs.filter(c => c.is_active).map(c => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {c.language || 'Unnamed'} ({c.country_prefix || 'Any'}) — 1st:{c.primary_language_code || 'en'} 2nd:{c.secondary_language_code || 'en'}
                  </option>
                ))}
              </select>
            </div>
          </Card>
          {uploadTarget && (
            <div className="flex items-center gap-2 bg-white rounded-lg border p-1">
              <button onClick={() => setAudioLayer('primary')}
                className={'px-3 py-1.5 rounded-md text-sm font-medium transition-all ' +
                  (audioLayer === 'primary' ? 'bg-blue-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100')}>
                1st: {uploadTarget.primary_language_code || 'en'}
              </button>
              <button onClick={() => setAudioLayer('secondary')}
                className={'px-3 py-1.5 rounded-md text-sm font-medium transition-all ' +
                  (audioLayer === 'secondary' ? 'bg-purple-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100')}>
                2nd: {uploadTarget.secondary_language_code || 'en'}
              </button>
            </div>
          )}
          {/* Quick-select pills */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-gray-400 font-medium">Quick:</span>
            {configs.filter(c => c.is_active).slice(0, 8).map(c => (
              <button
                key={String(c.id)}
                onClick={() => { setUploadTarget(c); setAudioLayer('primary'); }}
                className={'px-2.5 py-1 rounded-full text-xs font-medium border transition-all ' +
                  (uploadTarget && String(uploadTarget.id) === String(c.id)
                    ? 'bg-purple-600 text-white border-purple-600 shadow'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-700')}>
                {c.language || c.country_prefix || 'Grp ' + String(c.id)}
              </button>
            ))}
            {configs.filter(c => c.is_active).length > 8 && (
              <span className="text-xs text-gray-400">+{configs.filter(c => c.is_active).length - 8} more</span>
            )}
          </div>
          {uploading && <span className="text-sm text-blue-600 animate-pulse flex items-center gap-1"><span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> Uploading...</span>}
        </div>

        {!uploadTarget && configs.length === 0 && (
          <Card><p className="text-gray-500 text-center py-8">No language groups exist. Add one in the Language Configs tab first.</p></Card>
        )}

        {uploadTarget && <>
          {/* Greeting cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(['greeting', 'secondary_greeting'] as const).map((gfield, gi) => {
              const isPrimary = gi === 0;
              const url = isPrimary ? uploadTarget.greeting_audio_url : uploadTarget.secondary_greeting_audio_url;
              const hasAudio = !!url;
              return (
                <Card key={gfield} className={!isPrimary ? 'border-purple-200' : ''}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={isPrimary ? 'info' : 'warning'} size="sm">{isPrimary ? 'Primary' : 'Secondary'} Greeting</Badge>
                      <span className="text-xs text-gray-400">{isPrimary ? uploadTarget.primary_language_code : uploadTarget.secondary_language_code}</span>
                    </div>
                    {hasAudio ? <Badge variant="success" size="sm" dot>✓ Uploaded</Badge> : <Badge variant="info" size="sm">No file</Badge>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" icon={<Upload size={14} />} onClick={() => handleGreetingUpload(gfield)}>Upload</Button>
                    {hasAudio && <Button variant={playingKey === gfield ? 'danger' : 'primary'} size="sm" icon={playingKey === gfield ? <Pause size={14} /> : <Play size={14} />} onClick={() => playAudio(url!, gfield)}>{playingKey === gfield ? 'Stop' : 'Play'}</Button>}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Reuse banner */}
          {isReusingPrimary && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-2 text-sm text-amber-800 flex items-center gap-2">
              <RefreshCw size={16} />↻ Reusing primary digit audio for secondary (no secondary audio uploaded yet)
            </div>
          )}

          {/* Digit grid */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-700">Digit Audio (0–9)</h3>
                <Badge variant="info" size="sm">{digitCount}/10 uploaded</Badge>
              </div>
              {digitCount > 0 && (
                <div className="flex gap-2">
                  <button onClick={handleDownloadZip} disabled={downloadingZip}
                    className="px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 transition-all bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300 disabled:opacity-50">
                    <Download size={12} />{downloadingZip ? 'Zipping...' : 'Download ZIP'}
                  </button>
                  <button onClick={playAllDigits}
                    className={'px-3 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 transition-all ' + (playingAll ? 'bg-orange-500 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200 border border-green-300')}>
                    {playingAll ? <Pause size={12} /> : <SkipForward size={12} />}{playingAll ? 'Stop' : 'Play All 0-9'}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-3">
              {Array.from({ length: 10 }, (_, i) => String(i)).map(digit => {
                const hasAudio = hasDigitAudio(digit);
                const isDraggedOver = dragOverDigit === digit;
                return (
                  <div key={digit}
                    onDragOver={(e) => handleDragOver(e)}
                    onDragEnter={(e) => handleDragEnter(e, digit)}
                    onDragLeave={(e) => handleDragLeave(e, digit)}
                    onDrop={(e) => handleDigitDrop(e, digit)}
                    className={'relative rounded-xl border-2 p-3 flex flex-col items-center gap-2 transition-all ' +
                      (isDraggedOver ? 'border-blue-400 bg-blue-50 shadow-lg ring-2 ring-blue-200 scale-[1.03] border-dashed' :
                        hasAudio ? 'border-green-300 bg-green-50/30 ring-1 ring-green-200' : 'border-gray-200 bg-gray-50')}>
                    {isDraggedOver && <div className="absolute inset-0 flex items-center justify-center bg-blue-50/80 rounded-xl z-10"><Upload size={20} className="text-blue-600 animate-bounce" /></div>}
                    <div className={'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ' + (hasAudio ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-500')}>{digit}</div>
                    <span className={'text-[10px] font-medium ' + (hasAudio ? 'text-green-600' : 'text-gray-400')}>{hasAudio ? 'Ready' : 'Pending'}</span>
                    <div className="flex flex-col w-full gap-1">
                      <button onClick={() => triggerDigitUpload(digit)} className="w-full px-2 py-1.5 rounded text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 flex items-center justify-center gap-1"><Upload size={10} />Upload</button>
                      {hasAudio && (
                        <button onClick={() => { const url = getDigitAudioUrl(digit); if (url) playAudio(url, digit); }} className="w-full px-2 py-1.5 rounded text-xs font-medium bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200 flex items-center justify-center gap-1">{playingKey === digit ? <Pause size={10} /> : <Play size={10} />}{playingKey === digit ? 'Stop' : 'Play'}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Hidden file input for digit upload */}
          <input id="digit-file-input" type="file" accept="audio/mp3,audio/wav,audio/mpeg,audio/x-wav" className="hidden" onChange={handleDigitFileSelected} />

          {/* Audio Upload Status table */}
          <Card>
            <h3 className="font-semibold text-gray-700 mb-3">Audio Upload Status (all groups)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-gray-500 uppercase tracking-wider">
                    <th className="text-left px-2 py-2">Group</th>
                    <th className="text-center px-2 py-2">1st Greeting</th>
                    <th className="text-center px-2 py-2">1st Digits</th>
                    <th className="text-center px-2 py-2">2nd Greeting</th>
                    <th className="text-center px-2 py-2">2nd Digits</th>
                    <th className="text-center px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map(cfg => {
                    const g1 = !!cfg.greeting_audio_url;
                    const g2 = !!cfg.secondary_greeting_audio_url;
                    const hasSecondaryCfg = !!(cfg as any).secondary_language_code;
                    const am1 = parseAudioJson((cfg as any).audio_0_9_primary || cfg.audio_0_9);
                    const dc1 = Object.keys(am1).length;
                    const am2raw = (cfg as any).audio_0_9_secondary;
                    const am2 = am2raw ? parseAudioJson(am2raw) : null;
                    const dc2 = am2 ? Object.keys(am2).length : (am1 ? Object.keys(am1).length : 0);
                    const secReused = !am2raw && Object.keys(am1).length > 0;
                    // Full = primary greeting + all 10 primary digits + (if secondary configured) secondary greeting + all 10 secondary digits
                    const primaryFull = g1 && dc1 === 10;
                    const secondaryFull = !hasSecondaryCfg || (g2 && (am2 ? Object.keys(am2).length === 10 : dc1 === 10));
                    const allOk = primaryFull && secondaryFull;
                    const partial = g1 || g2 || dc1 > 0 || (am2 && Object.keys(am2).length > 0);
                    return (
                      <tr key={String(cfg.id)} className={'hover:bg-gray-50 ' + (uploadTarget && String(uploadTarget.id) === String(cfg.id) ? 'bg-blue-50' : '')}>
                        <td className="px-2 py-2.5">
                          <span className="font-medium text-gray-800 text-xs">{cfg.language || 'Unnamed'}</span>
                          <span className="text-gray-400 ml-1 text-[10px]">{cfg.country_prefix ? '+' + String(cfg.country_prefix).replace(/,/g, ', +') : ''} {cfg.primary_language_code}/{cfg.secondary_language_code}</span>
                        </td>
                        <td className="text-center px-2 py-2.5">{g1 ? <span className="text-green-600 font-bold">✓</span> : <span className="text-red-400">✗</span>}</td>
                        <td className="text-center px-2 py-2.5"><span className={dc1 === 10 ? 'text-green-600 font-semibold text-xs' : dc1 > 0 ? 'text-orange-500 font-semibold text-xs' : 'text-red-400 text-xs'}>{dc1}/10</span></td>
                        <td className="text-center px-2 py-2.5">{g2 ? <span className="text-green-600 font-bold">✓</span> : <span className="text-red-400">✗</span>}</td>
                        <td className="text-center px-2 py-2.5">
                          {secReused ? <span className="text-amber-500 font-semibold text-xs">↻ {dc2}/10</span>
                            : am2 ? <span className={Object.keys(am2).length === 10 ? 'text-green-600 font-semibold text-xs' : Object.keys(am2).length > 0 ? 'text-orange-500 font-semibold text-xs' : 'text-red-400 text-xs'}>{Object.keys(am2).length}/10</span>
                            : <span className="text-red-400 text-xs">0/10</span>}
                        </td>
                        <td className="text-center px-2 py-2.5">
                          {allOk ? <Badge variant="success" size="sm">Full</Badge>
                            : partial ? <Badge variant="warning" size="sm">Partial</Badge>
                            : <Badge variant="info" size="sm">Empty</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>}
      </div>}

      {/* ────── SIP CONFIG TAB (multi-server) ────── */}
      {tab === 'sip' && <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-700">SIP Server Configuration</h3>
            <p className="text-xs text-gray-400 mt-0.5">Add multiple SIP servers. The engine will route calls based on destination MCC/MNC matching.</p>
          </div>
          <div className="flex gap-2">
            <Button icon={<Plus size={14} />} onClick={openSipAdd} size="sm">Add Server</Button>
            <Button icon={<Save size={14} />} onClick={saveSipServers} loading={sipSaving} size="sm">Save All</Button>
          </div>
        </div>

        {sipLoading ? <p className="text-gray-400 text-sm">Loading...</p> :
         sipServers.length === 0 ? (
          <Card><p className="text-gray-400 text-center py-8 text-sm">No SIP servers configured. Click "Add Server" to add one.</p></Card>
        ) : (
          <div className="grid gap-3">
            {sipServers.map((srv, idx) => (
              <Card key={srv.id || idx} className="hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                    <div>
                      <span className="text-xs text-gray-400">Name</span>
                      <p className="font-semibold text-gray-800">{srv.name || 'Unnamed'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">Host:Port</span>
                      <p className="font-mono text-gray-700">{srv.host || '-'}:{srv.port || 5060}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">Caller ID</span>
                      <p className="text-gray-700">{srv.caller_id || '-'}{srv.is_e164 ? <span className="ml-1"><Badge variant="info" size="sm">E.164</Badge></span> : null}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">Codec</span>
                      <p className="text-gray-700 uppercase">{srv.codec || 'g729'}</p>
                    </div>
                    <div className="col-span-2 md:col-span-4">
                      <span className="text-xs text-gray-400">MCC/MNC Filter</span>
                      <p className="text-gray-600 text-xs font-mono">{srv.mccmnc_allowed || '*'}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 ml-3">
                    <button onClick={() => openSipEdit(idx)} className="p-1.5 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-400" /></button>
                    <button onClick={() => handleSipDelete(idx)} className="p-1.5 rounded hover:bg-red-50"><Trash2 size={14} className="text-red-400" /></button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* SIP Server Add/Edit Inline Card */}
        {showSipForm && (
          <Card className="border-2 border-purple-400 bg-purple-50/30">
            <h4 className="font-semibold text-gray-700 mb-4">{sipFormIdx !== null ? 'Edit Server' : 'Add SIP Server'}</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Input label="Server Name" value={sipForm.name} onChange={e => setSipForm(p => ({ ...p, name: e.target.value }))} placeholder="Main Gateway" />
              <Input label="SIP Host" value={sipForm.host} onChange={e => setSipForm(p => ({ ...p, host: e.target.value }))} placeholder="192.168.1.1" />
              <Input label="SIP Port" type="number" value={sipForm.port} onChange={e => setSipForm(p => ({ ...p, port: parseInt(e.target.value) || 5060 }))} />
              <Input label="Username (optional)" value={sipForm.username} onChange={e => setSipForm(p => ({ ...p, username: e.target.value }))} />
              <Input label="Password (optional)" value={sipForm.password} onChange={e => setSipForm(p => ({ ...p, password: e.target.value }))} type="password" />
              <Input label="Caller ID" value={sipForm.caller_id} onChange={e => setSipForm(p => ({ ...p, caller_id: e.target.value }))} placeholder="+1234567890" />
              <div>
                <label className="text-xs font-medium text-gray-500">Audio Codec</label>
                <select value={sipForm.codec} onChange={e => setSipForm(p => ({ ...p, codec: e.target.value as any }))} className="mt-1 block w-full rounded-lg border-gray-300 text-sm py-2 px-3 bg-white">
                  <option value="g729">G.729</option>
                  <option value="g711">G.711 (PCMU/PCMA)</option>
                  <option value="gsm">GSM</option>
                </select>
              </div>
              <Input label="MCC/MNC Allowed" value={sipForm.mccmnc_allowed} onChange={e => setSipForm(p => ({ ...p, mccmnc_allowed: e.target.value }))} placeholder="310,311,302 or *" />
            </div>
            <label className="flex items-center gap-2 mt-3">
              <input type="checkbox" checked={sipForm.is_e164} onChange={e => setSipForm(p => ({ ...p, is_e164: e.target.checked }))} className="w-4 h-4 rounded" />
              <span className="text-sm text-gray-700">Caller ID is E.164 format (+country prefix)</span>
            </label>
            <div className="flex gap-2 mt-4">
              <Button icon={<Save size={14} />} onClick={handleSipFormSave}>{sipFormIdx !== null ? 'Update' : 'Add'}</Button>
              <Button variant="secondary" onClick={() => setShowSipForm(false)}>Cancel</Button>
            </div>
          </Card>
        )}
      </div>}

      {/* ────── CALL LOGS TAB ────── */}
      {tab === 'logs' && <>
        <Card>
          <div className="flex flex-wrap gap-3">
            <select value={logFilter.status} onChange={e => setLogFilter(p => ({ ...p, status: e.target.value }))} className="border border-gray-300 rounded-lg text-sm px-3 py-2">
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="initiated">Initiated</option>
              <option value="ringing">Ringing</option>
              <option value="busy">Busy</option>
              <option value="no_answer">No Answer</option>
            </select>
            <input type="text" placeholder="Filter by destination..." value={logFilter.destination} onChange={e => setLogFilter(p => ({ ...p, destination: e.target.value }))} className="border border-gray-300 rounded-lg text-sm px-3 py-2" />
            <Button variant="secondary" size="sm" onClick={loadLogs} loading={logsLoading}><Search size={14} className="mr-1" />Filter</Button>
          </div>
        </Card>
        <Card noPadding>
          {logsLoading ? <p className="p-8 text-center text-gray-500">Loading logs...</p>
            : <Table columns={logColumns} data={logs} keyExtractor={(l: any) => String(l.id || l.call_id)} />}
        </Card>
      </>}

      {/* ────── LANGUAGE MODAL ────── */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Configuration' : 'Add Voice OTP Configuration'} size="lg"
        footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button icon={<Save size={14} />} onClick={handleSave} loading={saving}>{editing ? 'Update' : 'Add'}</Button></div>}>
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Language / Group Name *" value={form.language} onChange={e => setForm(p => ({ ...p, language: e.target.value }))} required />
            <Input label="Country Prefix(es)" value={form.country_prefix} onChange={e => setForm(p => ({ ...p, country_prefix: e.target.value }))} placeholder="93,91,880" />
            <Input label="1st Language Code" value={form.primary_language_code} onChange={e => setForm(p => ({ ...p, primary_language_code: e.target.value }))} placeholder="bn" />
            <Input label="2nd Language Code (optional)" value={form.secondary_language_code} onChange={e => setForm(p => ({ ...p, secondary_language_code: e.target.value }))} placeholder="en" />
            <div><label className="text-xs font-medium text-gray-500">Retry Count</label>
              <select value={form.retry_count} onChange={e => setForm(p => ({ ...p, retry_count: parseInt(e.target.value) }))} className="mt-1 block w-full rounded-lg border-gray-300 text-sm py-2 px-3 bg-white">
                {[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}
              </select></div>
            <div><label className="text-xs font-medium text-gray-500">Play Count</label>
              <select value={form.play_count} onChange={e => setForm(p => ({ ...p, play_count: parseInt(e.target.value) }))} className="mt-1 block w-full rounded-lg border-gray-300 text-sm py-2 px-3 bg-white">
                {[1,2,3].map(n => <option key={n} value={n}>{n}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Greeting Text" value={form.greeting_text} onChange={e => setForm(p => ({ ...p, greeting_text: e.target.value }))} />
            <Input label="Retry Text" value={form.retry_text} onChange={e => setForm(p => ({ ...p, retry_text: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-sm">Active</span></label>
        </div>
      </Modal>
    </div>
  );
};