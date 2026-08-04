import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Search, Edit, Trash2, Play, RefreshCw, Upload, Download, GripVertical, Check, AlertCircle, Hash, Type, MessageSquare, Shuffle, AtSign, Copy, ArrowRight, Zap, Eye, X, FileText, Trash, Layers, Ban, Shield } from 'lucide-react';
import { useData } from '../store/DataContext';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';
import { Modal } from '../components/UI/Modal';
import { Input, Select, Textarea } from '../components/UI/Input';
import { Translation } from '../types';
import { translationsApi } from '../services/api';

type TabId = 'number_prefix' | 'content_replace' | 'otp_extract' | 'sid_random' | 'sid_alias' | 'random_content' | 'number_blacklist' | 'keyword_blacklist' | 'keyword_whitelist' | 'url_block';

const TAB_CONFIG: Record<TabId, { label: string; icon: React.ReactNode; desc: string; color: string; csvHeaders: string }> = {
  number_prefix:    { label: 'Number Translation', icon: <Hash size={16} />, desc: 'Strip prefix digits or add prefix to destination numbers', color: 'from-amber-500 to-orange-600', csvHeaders: 'name,strip_prefix_digits,add_prefix_text,priority,is_active,apply_to,apply_entity_id' },
  content_replace:  { label: 'Content Translation', icon: <Type size={16} />, desc: 'Search & replace message content; OTP-aware forwarding', color: 'from-blue-500 to-cyan-600', csvHeaders: 'name,match_content,replace_content,is_otp_extract,otp_length_min,otp_length_max,priority,is_active,apply_to,apply_entity_id' },
  otp_extract:      { label: 'OTP Extract', icon: <MessageSquare size={16} />, desc: 'Automatically extract 4-8 digit OTP codes and forward only the digits to the supplier. No coding required.', color: 'from-green-500 to-emerald-600', csvHeaders: 'name,priority,is_active,apply_to,apply_entity_id' },
  sid_random:       { label: 'SID Random', icon: <Shuffle size={16} />, desc: 'Assign sender IDs to MCCMNC operators. Select country/operator below and set the SID.', color: 'from-purple-500 to-violet-600', csvHeaders: 'name,target_value,priority,is_active,apply_to,apply_entity_id' },
  sid_alias:        { label: 'SID Alias', icon: <AtSign size={16} />, desc: 'Wildcard (*) match sender ID and replace with new', color: 'from-pink-500 to-rose-600', csvHeaders: 'name,source_pattern,target_value,sid_match_type,priority,is_active,apply_to,apply_entity_id' },
  random_content:   { label: 'Random Content', icon: <Copy size={16} />, desc: 'Upload random templates via CSV; extract OTP into random content', color: 'from-indigo-500 to-blue-600', csvHeaders: 'name,target_value,is_otp_extract,otp_length_min,otp_length_max,priority,is_active,apply_to,apply_entity_id' },
  number_blacklist:  { label: 'Number DND', icon: <Ban size={16} />, desc: 'Block specific destination numbers or number prefixes (DND mode). Use subtype: exact or prefix.', color: 'from-red-500 to-rose-600', csvHeaders: 'name,source_pattern,subtype,priority,is_active,apply_to,apply_entity_id' },
  keyword_blacklist: { label: 'Keyword Block', icon: <AlertCircle size={16} />, desc: 'Block messages containing specific keywords (comma-separated in match_content)', color: 'from-red-500 to-rose-600', csvHeaders: 'name,match_content,priority,is_active,apply_to,apply_entity_id' },
  keyword_whitelist: { label: 'Keyword Allow', icon: <Check size={16} />, desc: 'Only allow messages containing specific keywords — block everything else', color: 'from-green-500 to-emerald-600', csvHeaders: 'name,match_content,priority,is_active,apply_to,apply_entity_id' },
  url_block:         { label: 'URL Block', icon: <Shield size={16} />, desc: 'Block messages containing URLs (http, https, www, domain.com, etc.)', color: 'from-red-500 to-rose-600', csvHeaders: 'name,source_pattern,priority,is_active,apply_to,apply_entity_id' },
};

const TABS: TabId[] = ['number_prefix', 'content_replace', 'otp_extract', 'sid_random', 'sid_alias', 'random_content', 'number_blacklist', 'keyword_blacklist', 'keyword_whitelist', 'url_block'];

// Live preview comparison row component
const ComparisonRow: React.FC<{ label: string; before: string; after: string; multiline?: boolean }> = ({ label, before, after, multiline }) => {
  const changed = before !== after;
  return (
    <div className={`rounded-lg p-3 transition-colors ${changed ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-100'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-medium text-gray-500 uppercase">{label}</span>
        {changed && <Badge variant="success" size="sm">transformed</Badge>}
      </div>
      <div className={`flex items-start gap-2 ${multiline ? 'flex-col' : 'flex-row flex-wrap'}`}>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] text-gray-400 mb-0.5">BEFORE</p>
          <code className={`text-xs block break-all ${multiline ? 'whitespace-pre-wrap' : ''} ${changed ? 'bg-red-50 text-red-700 line-through px-1.5 py-0.5 rounded' : 'bg-white px-1.5 py-0.5 rounded text-gray-700'}`}>
            {before || '(empty)'}
          </code>
        </div>
        <ArrowRight size={14} className={`flex-shrink-0 ${multiline ? 'hidden' : 'mt-4'} ${changed ? 'text-green-500' : 'text-gray-300'}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[9px] text-gray-400 mb-0.5">AFTER</p>
          <code className={`text-xs font-bold block break-all ${multiline ? 'whitespace-pre-wrap' : ''} ${changed ? 'bg-green-100 text-green-800 px-1.5 py-0.5 rounded border border-green-300' : 'bg-white px-1.5 py-0.5 rounded text-gray-700'}`}>
            {after || '(empty)'}
          </code>
        </div>
      </div>
    </div>
  );
};

export const TranslationsPage: React.FC = () => {
  const { clients, suppliers, mccmnc, fetchMCCMNC } = useData();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('number_prefix');
  const [allEntries, setAllEntries] = useState<Translation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Translation | null>(null);

  // Test state
  const [showTestModal, setShowTestModal] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testSenderId, setTestSenderId] = useState('');
  const [testDestination, setTestDestination] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testSidOutput, setTestSidOutput] = useState('');
  const [testDestOutput, setTestDestOutput] = useState('');

  // Inline OTP quick test state
  const [quickTestMsg, setQuickTestMsg] = useState('Your verification code is 123456. Do not share.');
  const [quickTestResult, setQuickTestResult] = useState<{ before: string; after: string; otpFound: string } | null>(null);
  const [quickTestError, setQuickTestError] = useState('');
  const [quickTestLoading, setQuickTestLoading] = useState(false);

  // Number Prefix inline quick test state
  const [npTestDest, setNpTestDest] = useState('008801712345678');
  const [npTestResult, setNpTestResult] = useState<{ before: string; after: string } | null>(null);
  const [npTestError, setNpTestError] = useState('');
  const [npTestLoading, setNpTestLoading] = useState(false);

  // SID Alias inline quick test state
  const [saTestSid, setSaTestSid] = useState('TECHCORP1');
  const [saTestResult, setSaTestResult] = useState<{ before: string; after: string } | null>(null);
  const [saTestError, setSaTestError] = useState('');
  const [saTestLoading, setSaTestLoading] = useState(false);

  // Live preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewInput, setPreviewInput] = useState({ destination: '008801712345678', sender_id: 'SENDER1', message: 'Your code is 123456' });
  const [previewOutput, setPreviewOutput] = useState<{ destination?: string; sender_id?: string; message?: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<any>(null);
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);



  // Bulk template upload state (for sid_random / random_content)
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [templateBulkText, setTemplateBulkText] = useState('');
  const [templateUploadMode, setTemplateUploadMode] = useState<'append' | 'replace'>('append');
  const [templateBulkCount, setTemplateBulkCount] = useState(0);
  const [bulkConfirmFlash, setBulkConfirmFlash] = useState(false);
  const templateBulkInputRef = useRef<HTMLInputElement>(null);
  const templateDropRef = useRef<HTMLDivElement>(null);
  const [templateDragOver, setTemplateDragOver] = useState(false);

  // MCCMNC-to-SID mapping state (for sid_random tab)
  const [mccmncSidMap, setMccmncSidMap] = useState<Record<string, string>>({});
  const [mccmncSidSearch, setMccmncSidSearch] = useState('');
  const [mccmncSidPage, setMccmncSidPage] = useState(0);
  const mccmncSidPerPage = 50;
  const [mccmncSidSaving, setMccmncSidSaving] = useState(false);
  const [, setMccmncSidLoaded] = useState(false);

  // Generic form for all types
  const [form, setForm] = useState<Record<string, any>>({
    name: '', translation_type: 'number_prefix', priority: 1,
    apply_to: 'both', apply_entity_id: 'all', is_active: true,
    // Number prefix
    strip_prefix_digits: 0, add_prefix_text: '',
    // Content / OTP
    match_content: '', replace_content: '',
    is_otp_extract: false, otp_length_min: 4, otp_length_max: 8, otp_pattern: '', otp_strict_mode: true,
    // SID / Random
    source_pattern: '', target_value: '',
    sid_match_type: 'wildcard', template_data: [],
    // Legacy
    client_id: null, supplier_id: null,
  });

  // Load translations on mount
  const loadData = useCallback(async (type?: string) => {
    setLoading(true);
    try {
      const res: any = await translationsApi.getAll(type);
      if (res.success && res.data?.data) {
        setAllEntries(res.data.data.map((t: any) => ({
          ...t,
          template_data: typeof t.template_data === 'string' ? JSON.parse(t.template_data || '[]') : (t.template_data || [])
        })));
      } else if (res.success && Array.isArray(res.data)) {
        setAllEntries(res.data.map((t: any) => ({
          ...t,
          template_data: typeof t.template_data === 'string' ? JSON.parse(t.template_data || '[]') : (t.template_data || [])
        })));
      }
    } catch (e) { console.warn('Translation fetch failed:', e); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(activeTab); }, [activeTab, loadData]);

  // Live preview: debounced auto-test on form change
  const runPreview = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await translationsApi.test({
        translation_type: form.translation_type || activeTab,
        source_pattern: form.source_pattern,
        target_value: form.target_value,
        match_content: form.match_content,
        replace_content: form.replace_content,
        strip_prefix_digits: form.strip_prefix_digits,
        add_prefix_text: form.add_prefix_text,
        is_otp_extract: form.is_otp_extract,
        otp_length_min: form.otp_length_min,
        otp_length_max: form.otp_length_max,
        otp_pattern: form.otp_pattern,
        template_data: form.template_data,
        test_input: previewInput.message,
        test_sender_id: previewInput.sender_id,
        test_destination: previewInput.destination,
      });
      if (res.success && res.data?.data) {
        setPreviewOutput(res.data.data);
      } else {
        setPreviewError('No result returned');
      }
    } catch (e: any) {
      setPreviewError(e?.message || 'Preview failed');
    }
    setPreviewLoading(false);
  };

  const schedulePreview = () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(runPreview, 400);
  };

  // Auto-trigger preview when form or input changes (while modal is open and preview is visible)
  useEffect(() => {
    if (showPreview && showModal) schedulePreview();
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [showPreview, showModal, form, previewInput]);

  // Filter entries by active tab + search
  const tabEntries = allEntries.filter(e => e.translation_type === activeTab);
  const filtered = tabEntries.filter(e =>
    !search || e.name?.toLowerCase().includes(search.toLowerCase()) ||
    e.description?.toLowerCase().includes(search.toLowerCase()) ||
    (e.source_pattern || '').toLowerCase().includes(search.toLowerCase()) ||
    (e.target_value || '').toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Tab switching resets pagination
  const switchTab = (tab: TabId) => { setActiveTab(tab); setCurrentPage(1); setSearch(''); };

  // Open modal for add/edit
  const openModal = (entry?: Translation) => {
    if (entry) {
      setEditing(entry);
      setForm({
        name: entry.name, translation_type: entry.translation_type, priority: entry.priority,
        apply_to: entry.apply_to, apply_entity_id: entry.apply_entity_id, is_active: entry.is_active,
        strip_prefix_digits: entry.strip_prefix_digits || 0, add_prefix_text: entry.add_prefix_text || '',
        match_content: entry.match_content || '', replace_content: entry.replace_content || '',
        is_otp_extract: entry.is_otp_extract || false, otp_length_min: entry.otp_length_min || 4, otp_length_max: entry.otp_length_max || 8, otp_pattern: entry.otp_pattern || '',
        source_pattern: entry.source_pattern || '', target_value: entry.target_value || '',
        sid_match_type: entry.sid_match_type || 'wildcard',
        template_data: Array.isArray(entry.template_data) ? entry.template_data : (typeof entry.template_data === 'string' ? entry.template_data : []),
        client_id: entry.client_id, supplier_id: entry.supplier_id,
      });
    } else {
      setEditing(null);
      setForm({
        name: '', translation_type: activeTab, priority: tabEntries.length + 1,
        apply_to: 'both', apply_entity_id: 'all', is_active: true,
        strip_prefix_digits: 0, add_prefix_text: '',
        match_content: '', replace_content: '',
        is_otp_extract: false, otp_length_min: 4, otp_length_max: 8, otp_pattern: '',
        source_pattern: '', target_value: '',
        sid_match_type: 'wildcard', template_data: [],
        client_id: null, supplier_id: null,
      });
    }
    setShowModal(true);
  };

  const updateForm = (key: string, value: any) => setForm(p => ({ ...p, [key]: value }));

  // Save
  const save = async () => {
    try {
      const payload: any = { ...form, translation_type: activeTab };
      // OTP Extract: auto-set engine defaults — no coding required
      if (activeTab === 'otp_extract') {
        payload.is_otp_extract = true;
        payload.replace_content = '{{OTP}}';
        payload.otp_length_min = 4;
        payload.otp_length_max = 8;
        payload.otp_pattern = '';
        // Preserve otp_strict_mode from form (default: true = strict blocking)
      }
      if (editing) {
        await translationsApi.update(editing.id, payload);
      } else {
        await translationsApi.create(payload);
      }
      setShowModal(false);
      await loadData(activeTab);
    } catch (e: any) { alert('Save failed: ' + (e.message || 'Unknown error')); }
  };

  // Delete
  const del = async (id: string) => {
    if (!confirm('Delete this translation?')) return;
    await translationsApi.delete(id);
    await loadData(activeTab);
  };

  // Delete all of current type
  const deleteAll = async () => {
    if (!confirm(`Delete ALL "${TAB_CONFIG[activeTab].label}" translations? This cannot be undone.`)) return;
    await translationsApi.bulkDelete({ type: activeTab });
    await loadData(activeTab);
  };

  // Test translation
  const testTrans = async () => {
    try {
      const res: any = await translationsApi.test({
        translation_type: activeTab,
        source_pattern: form.source_pattern, target_value: form.target_value,
        match_content: form.match_content, replace_content: form.replace_content,
        strip_prefix_digits: form.strip_prefix_digits, add_prefix_text: form.add_prefix_text,
        is_otp_extract: form.is_otp_extract,
        otp_length_min: form.otp_length_min, otp_length_max: form.otp_length_max,
        template_data: form.template_data,
        test_input: testInput, test_sender_id: testSenderId, test_destination: testDestination,
      });
      if (res.success && res.data?.data) {
        setTestOutput(res.data.data.output || '');
        setTestSidOutput(res.data.data.sender_id || '');
        setTestDestOutput(res.data.data.destination || '');
      }
    } catch (e: any) { alert('Test failed: ' + (e.message || 'Error')); }
  };

  // Import CSV
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => { setImportText(ev.target?.result as string); setImportResult(null); };
    r.readAsText(file);
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    setImportLoading(true);
    try {
      const res: any = await translationsApi.import(importText, activeTab);
      if (res.success && res.data?.data) {
        setImportResult(res.data.data);
        await loadData(activeTab);
      }
    } catch (e: any) { alert('Import failed: ' + (e.message || 'Error')); }
    setImportLoading(false);
  };

  const handleExport = async () => {
    try {
      const res: any = await translationsApi.export(activeTab);
      if (res.success && res.data) {
        const blob = new Blob([res.data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `translations_${activeTab}_${new Date().toISOString().split('T')[0]}.csv`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) { /* export failed */ }
  };

  const downloadSample = async () => {
    try {
      const res: any = await translationsApi.getSample(activeTab);
      if (res.success && res.data) {
        const blob = new Blob([res.data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `sample_${activeTab}.csv`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) { /* fallback */ }
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => { setImportText(ev.target?.result as string); setImportResult(null); setShowImportModal(true); };
    r.readAsText(file);
  };



  // Bulk template upload: parse lines from text or file and add to template_data
  const parseTemplateLines = (text: string): string[] => {
    return text.split(/[\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);
  };

  const MAX_TEMPLATES = 10000;

  const commitBulkTemplates = () => {
    let lines = parseTemplateLines(templateBulkText);
    if (lines.length === 0) return;
    // Enforce max template limit
    if (lines.length > MAX_TEMPLATES) {
      alert(`Too many templates: ${lines.length.toLocaleString()}. Maximum is ${MAX_TEMPLATES.toLocaleString()}. Truncating to first ${MAX_TEMPLATES.toLocaleString()}.`);
      lines = lines.slice(0, MAX_TEMPLATES);
    }
    if (templateUploadMode === 'replace') {
      updateForm('template_data', lines);
      updateForm('target_value', lines.join('|'));
    } else {
      const existing = Array.isArray(form.template_data) ? [...form.template_data] : [];
      // Deduplicate: only add lines not already in the pool
      const existingSet = new Set(existing);
      const newLines = lines.filter(l => !existingSet.has(l));
      const totalAfterMerge = existing.length + newLines.length;
      if (totalAfterMerge > MAX_TEMPLATES) {
        alert(`Pool would exceed ${MAX_TEMPLATES.toLocaleString()} templates. Only ${MAX_TEMPLATES - existing.length} new templates will be added.`);
        lines = newLines.slice(0, MAX_TEMPLATES - existing.length);
      } else {
        lines = newLines;
      }
      const merged = [...existing, ...lines];
      updateForm('template_data', merged);
      updateForm('target_value', merged.join('|'));
    }
    setTemplateBulkCount(lines.length);
    setTemplateBulkText('');
    // Flash confirmation
    setBulkConfirmFlash(true);
    setTimeout(() => setBulkConfirmFlash(false), 1500);
  };

  const handleTemplateFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Warn on very large files (>5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB. Processing may be slow. Consider splitting into smaller files.`);
    }
    const r = new FileReader();
    r.onload = (ev) => {
      const text = ev.target?.result as string || '';
      const lines = parseTemplateLines(text);
      if (lines.length > MAX_TEMPLATES) {
        alert(`File contains ${lines.length.toLocaleString()} templates. Only the first ${MAX_TEMPLATES.toLocaleString()} will be loaded.`);
        setTemplateBulkText(lines.slice(0, MAX_TEMPLATES).join('\n'));
        setTemplateBulkCount(MAX_TEMPLATES);
      } else {
        setTemplateBulkText(text);
        setTemplateBulkCount(lines.length);
      }
    };
    r.readAsText(file);
  };

  const handleTemplateDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setTemplateDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB. Processing may be slow.`);
    }
    const r = new FileReader();
    r.onload = (ev) => {
      const text = ev.target?.result as string || '';
      const lines = parseTemplateLines(text);
      if (lines.length > MAX_TEMPLATES) {
        alert(`File contains ${lines.length.toLocaleString()} templates. Only first ${MAX_TEMPLATES.toLocaleString()} will be loaded.`);
        setTemplateBulkText(lines.slice(0, MAX_TEMPLATES).join('\n'));
        setTemplateBulkCount(MAX_TEMPLATES);
      } else {
        setTemplateBulkText(text);
        setTemplateBulkCount(lines.length);
      }
    };
    r.readAsText(file);
  };

  const handleTemplateDragOver = (e: React.DragEvent) => { e.preventDefault(); setTemplateDragOver(true); };
  const handleTemplateDragLeave = () => setTemplateDragOver(false);

  const clearAllTemplates = () => {
    updateForm('template_data', []);
    updateForm('target_value', '');
    setTemplateBulkCount(0);
    setTemplateBulkText('');
  };

  // MCCMNC-to-SID mapping functions
  const loadSidMappings = useCallback(async () => {
    try {
      const res: any = await translationsApi.getAll('sid_random');
      const rules: any[] = (res.success && res.data?.data) ? res.data.data : 
                           (res.success && Array.isArray(res.data)) ? res.data : [];
      const map: Record<string, string> = {};
      for (const r of rules) {
        const mccmncList = r.mccmnc_list || [];
        const tpl = Array.isArray(r.template_data) ? r.template_data : 
                   (typeof r.template_data === 'string' ? JSON.parse(r.template_data || '[]') : []);
        const sid = tpl[0] || '';
        for (const mid of mccmncList) {
          if (mid != null && sid) map[String(mid)] = sid;
        }
      }
      setMccmncSidMap(map);
      setMccmncSidLoaded(true);
    } catch (_) { /* best effort */ }
  }, []);

  // Load MCCMNC-to-SID mappings when SID Random tab is active or when entries change
  useEffect(() => {
    if (activeTab === 'sid_random') {
      loadSidMappings();
      // Fetch more MCCMNC entries for the mapping table (up to 5000)
      fetchMCCMNC({ limit: 5000 });
    }
  }, [activeTab, allEntries.length, loadSidMappings, fetchMCCMNC]);

  const saveAllSidMappings = async () => {
    setMccmncSidSaving(true);
    try {
      // Get existing MCCMNC-based rules
      const res: any = await translationsApi.getAll('sid_random');
      const rules: any[] = (res.success && res.data?.data) ? res.data.data :
                           (res.success && Array.isArray(res.data)) ? res.data : [];
      const existingByMccmnc: Record<string, any> = {};
      for (const r of rules) {
        const list = r.mccmnc_list || [];
        for (const mid of list) {
          if (mid != null) existingByMccmnc[String(mid)] = r;
        }
      }

      let created = 0, updated = 0, deleted = 0;

      // Create/update mappings
      for (const [mccmncIdStr, sid] of Object.entries(mccmncSidMap)) {
        if (!sid.trim()) continue;
        const mccmncEntry = mccmnc.find(m => String(m.id) === mccmncIdStr);
        const existingRule = existingByMccmnc[mccmncIdStr];
        // Construct rule name from the MCCMNC ID directly (no lookup needed)
        const mccMncName = mccmncEntry ? `${mccmncEntry.mcc}${mccmncEntry.mnc}` : `MCCMNC#${mccmncIdStr}`;
        const payload = {
          translation_type: 'sid_random' as const,
          name: `${mccMncName} → ${sid.trim()}`,
          template_data: [sid.trim()],
          target_value: sid.trim(),
          mccmnc_list: [parseInt(mccmncIdStr)],
          priority: 1,
          is_active: true,
          apply_to: 'both',
          apply_entity_id: 'all',
        };
        if (existingRule) {
          // Update if SID changed
          const oldSid = (Array.isArray(existingRule.template_data) ? existingRule.template_data[0] : '') || '';
          if (oldSid !== sid.trim()) {
            await translationsApi.update(existingRule.id, payload);
            updated++;
          }
        } else {
          await translationsApi.create(payload);
          created++;
        }
      }

      // Delete mappings that were cleared
      for (const [mccmncIdStr, rule] of Object.entries(existingByMccmnc)) {
        if (!mccmncSidMap[mccmncIdStr] || !mccmncSidMap[mccmncIdStr].trim()) {
          await translationsApi.delete(rule.id);
          deleted++;
        }
      }

      alert(`Mappings saved: ${created} created, ${updated} updated, ${deleted} removed`);
      setMccmncSidLoaded(false); // force reload
      await loadData(activeTab);
    } catch (e: any) {
      alert('Save failed: ' + (e.message || 'Unknown error'));
    }
    setMccmncSidSaving(false);
  };

  const clearSidMapping = (mccmncId: string) => {
    setMccmncSidMap(p => {
      const n = { ...p };
      delete n[mccmncId];
      return n;
    });
  };

  // Render table based on tab type
  const renderTable = () => {
    const commonCols = [
      { key: 'name', header: 'Name', render: (e: Translation) => (
        <div><p className="font-medium text-sm">{e.name || 'Unnamed'}</p><p className="text-[10px] text-gray-500">Priority: {e.priority}</p></div>
      )},
    ];

    const typeSpecificCols: Record<TabId, any[]> = {
      number_prefix: [
        { key: 'strip', header: 'Strip Prefix', render: (e: Translation) => <code className="text-xs bg-red-50 text-red-700 px-1.5 py-0.5 rounded">{e.strip_prefix_digits || 0} digits</code> },
        { key: 'add', header: 'Add Prefix', render: (e: Translation) => <code className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded">{e.add_prefix_text || '-'}</code> },
      ],
      content_replace: [
        { key: 'match', header: 'Match', render: (e: Translation) => <code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded max-w-[150px] truncate block">{e.match_content?.slice(0, 30) || '-'}</code> },
        { key: 'replace', header: 'Replace', render: (e: Translation) => <code className="text-[10px] bg-green-50 text-green-700 px-1 py-0.5 rounded max-w-[150px] truncate block">{e.replace_content?.slice(0, 30) || '-'}</code> },
        { key: 'otp', header: 'OTP?', render: (e: Translation) => e.is_otp_extract ? <Badge variant="success" size="sm">OTP {e.otp_length_min}-{e.otp_length_max}</Badge> : <Badge variant="warning" size="sm">Promo</Badge> },
      ],
      otp_extract: [
        { key: 'desc', header: 'What it does', render: () => <span className="text-xs text-gray-500">Extracts 4-8 digit OTP → forwards only digits</span> },
      ],
      sid_random: [
        { key: 'templates', header: 'SID Pool', render: (e: Translation) => {
          const list = Array.isArray(e.template_data) ? e.template_data : (typeof e.target_value === 'string' ? e.target_value.split('|').filter(Boolean) : []);
          return <div className="flex flex-wrap gap-1 max-w-[200px]">{list.slice(0, 5).map((s, i) => <span key={i} className="text-[9px] bg-purple-50 text-purple-700 px-1 py-0.5 rounded font-mono">{typeof s === 'string' ? s : ''}</span>)}{list.length > 5 && <span className="text-[9px] text-gray-400">+{list.length - 5} more</span>}</div>;
        }},
      ],
      sid_alias: [
        { key: 'pattern', header: 'Pattern', render: (e: Translation) => <code className="text-[10px] bg-blue-50 text-blue-700 px-1 py-0.5 rounded">{e.source_pattern?.slice(0, 25) || '-'}</code> },
        { key: 'replace', header: 'Replace With', render: (e: Translation) => <code className="text-[10px] bg-green-50 text-green-700 px-1 py-0.5 rounded">{e.target_value?.slice(0, 25) || '-'}</code> },
      ],
      random_content: [
        { key: 'templates', header: 'Templates', render: (e: Translation) => {
          const list = Array.isArray(e.template_data) ? e.template_data : (typeof e.target_value === 'string' ? e.target_value.split('|').filter(Boolean) : []);
          return <span className="text-xs">{list.length} templates</span>;
        }},
        { key: 'otp', header: 'OTP', render: (e: Translation) => e.is_otp_extract ? <Badge variant="success" size="sm">{e.otp_length_min}-{e.otp_length_max}d</Badge> : <Badge variant="default" size="sm">No</Badge> },
      ],
      number_blacklist: [
        { key: 'pattern', header: 'Blocked Number', render: (e: Translation) => <code className="text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded font-mono">{e.source_pattern || '-'}</code> },
        { key: 'mode', header: 'Mode', render: (e: Translation) => <Badge variant={e.subtype === 'exact' ? 'danger' : 'warning'} size="sm">{e.subtype || 'prefix'}</Badge> },
      ],
      keyword_blacklist: [
        { key: 'keywords', header: 'Blocked Keywords', render: (e: Translation) => (
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {(e.match_content || '').split(',').map((k: string, i: number) => <span key={i} className="text-[9px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">{k.trim().slice(0,15)}</span>)}
          </div>
        )},
      ],
      keyword_whitelist: [
        { key: 'keywords', header: 'Allowed Keywords', render: (e: Translation) => (
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {(e.match_content || '').split(',').map((k: string, i: number) => <span key={i} className="text-[9px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded">{k.trim().slice(0,15)}</span>)}
          </div>
        )},
      ],
      url_block: [
        { key: 'desc', header: 'What it does', render: () => <span className="text-xs text-red-600">Blocks all messages containing URLs</span> },
        { key: 'allowed', header: 'Allow Pattern', render: (e: Translation) => e.source_pattern ? <code className="text-[10px] bg-green-50 text-green-700 px-1 py-0.5 rounded">{e.source_pattern}</code> : <span className="text-xs text-gray-400">All URLs blocked</span> },
      ],
    };

    const statusCol = { key: 'status', header: 'Status', render: (e: Translation) => <Badge variant={e.is_active ? 'success' : 'danger'} dot size="sm">{e.is_active ? 'Active' : 'Inactive'}</Badge> };
    const applyCol = { key: 'apply', header: 'Applied To', render: (e: Translation) => {
      if (e.apply_to === 'both' || !e.apply_entity_id || e.apply_entity_id === 'all') {
        return <Badge variant="warning" size="sm">All</Badge>;
      }
      const arr = e.apply_to === 'client' ? clients : suppliers;
      const entity = arr.find((x: any) => String(x.id) === String(e.apply_entity_id));
      const name = entity ? `${(entity as any).client_code || (entity as any).supplier_code} - ${(entity as any).company_name}` : `${e.apply_to === 'client' ? 'Client' : 'Supplier'} #${e.apply_entity_id}`;
      return <Badge variant={e.apply_to === 'client' ? 'info' : 'purple'} size="sm">{name}</Badge>;
    } };
    const actionsCol = { key: 'actions', header: '', render: (e: Translation) => (
      <div className="flex gap-1">
        <button onClick={() => { setEditing(e); setForm({ ...form, ...e, template_data: Array.isArray(e.template_data) ? e.template_data : (typeof e.template_data === 'string' ? JSON.parse(e.template_data || '[]') : []) }); setTestInput('Test OTP 123456 message'); setTestSenderId('SENDER1'); setTestDestination('008801712345678'); setTestOutput(''); setShowTestModal(true); }} className="p-1 rounded hover:bg-gray-100"><Play size={14} className="text-green-500" /></button>
        <button onClick={() => openModal(e)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500" /></button>
        <button onClick={() => del(e.id)} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500" /></button>
      </div>
    )};

    const typedCols = typeSpecificCols[activeTab] || [];
    const cols = [...commonCols, ...typedCols, applyCol, statusCol, actionsCol];

    return (
      <Card noPadding>
        {loading ? (
          <div className="flex items-center justify-center py-12"><RefreshCw size={24} className="animate-spin text-blue-500 mr-2" /><span className="text-gray-500">Loading...</span></div>
        ) : (
          <>
            <Table columns={cols} data={activeTab === 'sid_random' ? paginated.filter(e => !e.mccmnc_list || (Array.isArray(e.mccmnc_list) && e.mccmnc_list.length === 0)) : paginated} keyExtractor={e => e.id} />
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage} />
          </>
        )}
      </Card>
    );
  };

  // Render form fields based on tab
  const renderFormFields = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Name *" value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder="Rule name" required />
        <Input label="Priority" type="number" value={form.priority} onChange={e => updateForm('priority', parseInt(e.target.value) || 1)} min={1} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Select label="Apply To" value={form.apply_to} onChange={e => updateForm('apply_to', e.target.value)} options={[
          { value: 'both', label: 'All Clients & Suppliers' },
          { value: 'client', label: 'Specific Client' },
          { value: 'supplier', label: 'Specific Supplier' },
        ]} />
        {form.apply_to !== 'both' && (
          <Select label={form.apply_to === 'client' ? 'Client' : 'Supplier'} value={form.apply_entity_id || ''} onChange={e => updateForm('apply_entity_id', e.target.value)} options={[
            { value: 'all', label: 'All' },
            ...(form.apply_to === 'client'
              ? clients.map(c => ({ value: String(c.id), label: `${c.client_code} - ${c.company_name}` }))
              : suppliers.map(s => ({ value: String(s.id), label: `${s.supplier_code} - ${s.company_name}` }))
            ),
          ]} />
        )}
        {form.apply_to === 'both' && <Input label="Applies to" disabled value="All clients and suppliers" />}
      </div>

      {/* Number Prefix fields */}
      {activeTab === 'number_prefix' && (
        <div className="grid grid-cols-2 gap-4 bg-amber-50 p-4 rounded-lg border border-amber-200">
          <div>
            <label className="text-sm font-medium text-amber-800 block mb-1">Strip Prefix (digits to remove)</label>
            <input type="number" value={form.strip_prefix_digits} onChange={e => updateForm('strip_prefix_digits', parseInt(e.target.value) || 0)} min={0} max={20} className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm bg-white" />
            <p className="text-[10px] text-amber-600 mt-1">00880 with strip=2 → 880</p>
          </div>
          <div>
            <label className="text-sm font-medium text-amber-800 block mb-1">Add Prefix (text to prepend)</label>
            <Input value={form.add_prefix_text} onChange={e => updateForm('add_prefix_text', e.target.value)} placeholder="77" />
            <p className="text-[10px] text-amber-600 mt-1">00880 + add "77" → 77880</p>
          </div>
        </div>
      )}

      {/* Content Replace fields */}
      {activeTab === 'content_replace' && (
        <>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Match Content</label>
            <Textarea value={form.match_content} onChange={e => updateForm('match_content', e.target.value)} rows={2} placeholder="Text to search for in messages..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Replace Content (use {'{{OTP}}'} for OTP placeholder)</label>
              <Textarea value={form.replace_content} onChange={e => updateForm('replace_content', e.target.value)} rows={2} placeholder="Replacement text or {{OTP}}" />
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.is_otp_extract} onChange={e => updateForm('is_otp_extract', e.target.checked)} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium">OTP Extraction Mode</span>
              </label>
              {form.is_otp_extract && (
                <div className="space-y-2 bg-blue-50 p-3 rounded-lg">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-blue-700 block">Min OTP Length</label>
                      <input type="number" value={form.otp_length_min} onChange={e => updateForm('otp_length_min', parseInt(e.target.value) || 4)} min={4} max={8} className="w-full px-2 py-1 border border-blue-200 rounded text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-blue-700 block">Max OTP Length</label>
                      <input type="number" value={form.otp_length_max} onChange={e => updateForm('otp_length_max', parseInt(e.target.value) || 8)} min={4} max={8} className="w-full px-2 py-1 border border-blue-200 rounded text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-blue-700 block">Custom Regex Pattern <span className="text-blue-400">(optional)</span></label>
                    <input type="text" value={form.otp_pattern || ''} onChange={e => updateForm('otp_pattern', e.target.value)} placeholder="e.g. ABC-\d{6} for branded OTPs" className="w-full px-2 py-1 border border-blue-200 rounded text-sm font-mono" />
                    <p className="text-[9px] text-blue-500 mt-0.5">Overrides min/max length. Use capture groups like <code className="bg-blue-100 px-1 rounded">(\d+)</code> for extraction.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* OTP Extract — simple no-code setup */}
      {activeTab === 'otp_extract' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-green-100 rounded-full flex-shrink-0 mt-0.5">
              <Check size={18} className="text-green-600" />
            </div>
            <div>
              <h4 className="font-semibold text-green-800 text-sm">Automatic OTP Extraction</h4>
              <p className="text-sm text-green-700 mt-1">
                When enabled, this rule scans every SMS message for <strong>4-8 digit numbers</strong> and forwards ONLY the digits to the supplier.
              </p>
              <div className="mt-3 bg-white rounded-lg border border-green-200 p-3">
                <p className="text-xs text-gray-500 mb-1">Example:</p>
                <div className="flex items-center gap-2 text-xs">
                  <code className="bg-red-50 text-red-600 px-2 py-1 rounded line-through">Your verification code is 482931. Do not share.</code>
                  <ArrowRight size={12} className="text-green-500" />
                  <code className="bg-green-100 text-green-700 px-2 py-1 rounded font-bold">482931</code>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  4-8 digit OTP range
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Digits only → supplier
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Full text saved in logs
                </span>
              </div>
            </div>
          </div>

          {/* Strict/Lenient Mode Toggle */}
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <h5 className="text-sm font-semibold text-gray-800">
                  {form.otp_strict_mode !== false ? '🔒 Strict Mode' : '🔓 Lenient Mode'}
                </h5>
                <p className="text-xs text-gray-500 mt-0.5 max-w-md">
                  {form.otp_strict_mode !== false
                    ? 'Messages without a numeric OTP code will be REJECTED. Only OTP messages reach the supplier.'
                    : 'Messages without a numeric code will still be FORWARDED unchanged. No blocking.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateForm('otp_strict_mode', form.otp_strict_mode === false ? true : false)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  form.otp_strict_mode !== false
                    ? 'bg-green-500 focus:ring-green-400'
                    : 'bg-gray-300 focus:ring-gray-400'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    form.otp_strict_mode !== false ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SID Alias fields */}
      {activeTab === 'sid_alias' && (
        <div className="grid grid-cols-2 gap-4 bg-pink-50 p-4 rounded-lg border border-pink-200">
          <div>
            <label className="text-sm font-medium text-pink-800 block mb-1">Match Pattern (use * for wildcard)</label>
            <Input value={form.source_pattern} onChange={e => updateForm('source_pattern', e.target.value)} placeholder="TECHCORP* or *SENDER*" />
            <p className="text-[10px] text-pink-600 mt-1">TECHCORP* matches TECHCORP, TECHCORP1, etc.</p>
          </div>
          <div>
            <label className="text-sm font-medium text-pink-800 block mb-1">Replace With</label>
            <Input value={form.target_value} onChange={e => updateForm('target_value', e.target.value)} placeholder="NEWSENDER" />
            <p className="text-[10px] text-pink-600 mt-1">Replace matched sender ID with this</p>
          </div>
        </div>
      )}

      {/* SID Random / Random Content fields */}
      {(activeTab === 'sid_random' || activeTab === 'random_content') && (
        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-purple-800">
              Templates (one per line)
              {Array.isArray(form.template_data) && form.template_data.length > 0 && (
                <span className="ml-2 text-xs font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                  {form.template_data.length} templates
                </span>
              )}
            </label>
            {Array.isArray(form.template_data) && form.template_data.length > 0 && (
              <button onClick={clearAllTemplates} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors">
                <Trash size={12} /> Clear all
              </button>
            )}
          </div>
          <Textarea
            value={Array.isArray(form.template_data) ? form.template_data.join('\n') : (typeof form.target_value === 'string' ? form.target_value.split('|').join('\n') : '')}
            onChange={e => {
              const lines = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
              updateForm('template_data', lines);
              updateForm('target_value', lines.join('|'));
            }}
            rows={6}
            placeholder={activeTab === 'sid_random' ? 'SID1\nSID2\nSID3' : 'Your OTP code is {{OTP}}\nVerification: {{OTP}}'}
            className="font-mono text-xs resize-y min-h-[100px] max-h-[300px]" 
          />
          {activeTab === 'random_content' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_otp_extract} onChange={e => updateForm('is_otp_extract', e.target.checked)} className="w-4 h-4 rounded" />
              <span className="text-sm">Extract OTP from original message (use {'{{OTP}}'} in templates)</span>
            </label>
          )}

          {/* ---- Bulk Upload Section (Collapsible) ---- */}
          <div className="border-t border-purple-200 pt-3 mt-2">
            <button
              onClick={() => setShowBulkUpload(s => !s)}
              className="flex items-center gap-2 w-full text-left hover:bg-purple-100/50 rounded-lg p-1.5 -m-1.5 transition-colors"
            >
              <Layers size={14} className="text-purple-600" />
              <span className="text-sm font-medium text-purple-800">Bulk Upload Templates</span>
              <span className="text-[10px] text-purple-500">— upload 100s of templates from a .txt file</span>
              <span className="ml-auto text-xs text-purple-400 transition-transform" style={{ transform: showBulkUpload ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
            </button>

            {showBulkUpload && (
            <div className="mt-2">

            {/* Mode toggle: Append / Replace */}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs text-gray-500">Mode:</span>
              <label className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors ${templateUploadMode === 'append' ? 'bg-green-100 text-green-700 font-semibold ring-1 ring-green-400' : 'bg-gray-100 text-gray-500'}`}>
                <input type="radio" name="tplMode" checked={templateUploadMode === 'append'} onChange={() => setTemplateUploadMode('append')} className="sr-only" />
                + Append to pool
              </label>
              <label className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors ${templateUploadMode === 'replace' ? 'bg-orange-100 text-orange-700 font-semibold ring-1 ring-orange-400' : 'bg-gray-100 text-gray-500'}`}>
                <input type="radio" name="tplMode" checked={templateUploadMode === 'replace'} onChange={() => setTemplateUploadMode('replace')} className="sr-only" />
                Replace pool
              </label>
            </div>

            {/* Drag & drop zone */}
            <div
              ref={templateDropRef}
              onDragOver={handleTemplateDragOver}
              onDragLeave={handleTemplateDragLeave}
              onDrop={handleTemplateDrop}
              onClick={() => templateBulkInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-3 text-center transition-colors cursor-pointer
                ${templateDragOver ? 'border-purple-500 bg-purple-100' : 'border-purple-300 hover:border-purple-400 bg-white'}`}
            >
              <FileText size={20} className="mx-auto mb-1 text-purple-400" />
              <p className="text-xs text-gray-600">Drag & drop <strong>.txt</strong> file here</p>
              <p className="text-[10px] text-gray-400">One template per line — or click to browse</p>
              <input
                ref={templateBulkInputRef}
                type="file"
                accept=".txt,.csv,.text"
                onChange={handleTemplateFilePick}
                className="hidden"
              />
            </div>

            {/* Paste textarea */}
            <Textarea
              value={templateBulkText}
              onChange={e => {
                setTemplateBulkText(e.target.value);
                setTemplateBulkCount(parseTemplateLines(e.target.value).length);
              }}
              rows={4}
              placeholder="Or paste templates here (one per line)...&#10;Template 1&#10;Template 2&#10;Template 3&#10;... up to 10,000 templates"
              className="font-mono text-[11px] mt-2 resize-y min-h-[60px] max-h-[200px]" 
            />

            {/* Actions row */}
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-500">
                {templateBulkCount > 0 ? (
                  <span className="font-semibold text-purple-600">{templateBulkCount} templates detected</span>
                ) : 'No templates loaded'}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setTemplateBulkText(''); setTemplateBulkCount(0); }}
                  disabled={!templateBulkText}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  icon={<Upload size={14} />}
                  onClick={commitBulkTemplates}
                  disabled={templateBulkCount === 0}
                  className={templateUploadMode === 'replace' ? 'bg-orange-500 hover:bg-orange-600 text-white border-orange-500' : 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600'}
                >
                  {templateUploadMode === 'replace' ? 'Replace Pool' : 'Add to Pool'} ({templateBulkCount})
                </Button>
              </div>
            </div>
              {bulkConfirmFlash && (
                <div className="mt-2 bg-green-50 border border-green-200 rounded-lg p-2 flex items-center gap-2 animate-pulse">
                  <Check size={14} className="text-green-600" />
                  <span className="text-xs font-medium text-green-700">
                    {templateUploadMode === 'replace' ? 'Pool replaced!' : 'Templates added to pool!'}
                  </span>
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* Number Blacklist fields */}
      {activeTab === 'number_blacklist' && (
        <div className="bg-red-50 p-4 rounded-lg border border-red-200 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-100 rounded-full flex-shrink-0 mt-0.5">
              <Ban size={18} className="text-red-600" />
            </div>
            <div>
              <h4 className="font-semibold text-red-800 text-sm">Number Blacklist (DND)</h4>
              <p className="text-sm text-red-700 mt-1">Block SMS delivery to specific numbers or number prefixes. Messages to blocked numbers will be rejected.</p>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-red-800 block mb-1">Number or Prefix to Block</label>
            <Input value={form.source_pattern} onChange={e => updateForm('source_pattern', e.target.value)} placeholder="88017 or 8801712345678" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Match Mode" value={form.subtype || 'prefix'} onChange={e => updateForm('subtype', e.target.value)} options={[
              { value: 'prefix', label: 'Prefix match (blocks all numbers starting with)' },
              { value: 'exact', label: 'Exact match (blocks only this number)' },
            ]} />
          </div>
        </div>
      )}

      {/* Keyword Blacklist fields */}
      {activeTab === 'keyword_blacklist' && (
        <div className="bg-red-50 p-4 rounded-lg border border-red-200 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-100 rounded-full flex-shrink-0 mt-0.5">
              <AlertCircle size={18} className="text-red-600" />
            </div>
            <div>
              <h4 className="font-semibold text-red-800 text-sm">Keyword Blacklist</h4>
              <p className="text-sm text-red-700 mt-1">Block messages containing any of these keywords. Messages will be rejected before reaching the supplier.</p>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-red-800 block mb-1">Blocked Keywords (comma-separated)</label>
            <Textarea value={form.match_content} onChange={e => updateForm('match_content', e.target.value)} rows={3} placeholder="spam, scam, fraud, casino" />
            <p className="text-[10px] text-red-600 mt-1">Case-insensitive. Partial matches work (e.g. "casino" blocks "Online Casino Now!")</p>
          </div>
        </div>
      )}

      {/* Keyword Whitelist fields */}
      {activeTab === 'keyword_whitelist' && (
        <div className="bg-green-50 p-4 rounded-lg border border-green-200 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-green-100 rounded-full flex-shrink-0 mt-0.5">
              <Check size={18} className="text-green-600" />
            </div>
            <div>
              <h4 className="font-semibold text-green-800 text-sm">Keyword Whitelist</h4>
              <p className="text-sm text-green-700 mt-1">Only allow messages containing at least one of these keywords. Everything else is blocked.</p>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-green-800 block mb-1">Allowed Keywords (comma-separated)</label>
            <Textarea value={form.match_content} onChange={e => updateForm('match_content', e.target.value)} rows={3} placeholder="otp, verification, code, confirm" />
            <p className="text-[10px] text-green-600 mt-1">Only messages containing these words will pass through.</p>
          </div>
        </div>
      )}

      {/* URL Block fields */}
      {activeTab === 'url_block' && (
        <div className="bg-red-50 p-4 rounded-lg border border-red-200 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-100 rounded-full flex-shrink-0 mt-0.5">
              <Shield size={18} className="text-red-600" />
            </div>
            <div>
              <h4 className="font-semibold text-red-800 text-sm">URL Block</h4>
              <p className="text-sm text-red-700 mt-1">When active, this rule blocks ALL messages containing URLs from being forwarded to the supplier.</p>
              <div className="mt-2 bg-white rounded border border-red-200 p-2">
                <p className="text-xs text-gray-500">Detects: <code className="bg-gray-100 px-1 rounded">http://</code>, <code className="bg-gray-100 px-1 rounded">https://</code>, <code className="bg-gray-100 px-1 rounded">www.</code>, common TLDs (.com, .net, .org, .io), and URL shorteners (bit.ly, goo.gl).</p>
              </div>
              <p className="text-xs text-red-500 mt-2">⚠ This rule has no configuration options — just toggle Active/Inactive to enable or disable URL blocking.</p>
            </div>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 mt-2">
        <input type="checkbox" checked={form.is_active} onChange={e => updateForm('is_active', e.target.checked)} className="w-4 h-4 rounded" />
        <span className="text-sm font-medium">Active</span>
      </label>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Translations</h1>
          <p className="text-gray-500 mt-1">6-type engine: Number, Content, OTP, SID Random, SID Alias, Random Content</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Download size={16} />} onClick={downloadSample}>Sample CSV</Button>
          <Button variant="secondary" icon={<Upload size={16} />} onClick={() => { setShowImportModal(true); setImportResult(null); setImportText(''); }}>Import CSV</Button>
          <Button variant="secondary" icon={<Download size={16} />} onClick={handleExport}>Export CSV</Button>
          <Button icon={<Plus size={18} />} onClick={() => openModal()}>Add Rule</Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 bg-white rounded-xl border p-1">
        {TABS.map(tab => {
          const cfg = TAB_CONFIG[tab];
          const count = allEntries.filter(e => e.translation_type === tab).length;
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap
                ${active ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {cfg.icon}
              <span className="hidden sm:inline">{cfg.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Tab description + stats */}
      <div className={`rounded-xl p-4 bg-gradient-to-r ${TAB_CONFIG[activeTab].color} text-white`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{TAB_CONFIG[activeTab].label}</h2>
            <p className="text-white/80 text-sm mt-1">{TAB_CONFIG[activeTab].desc}</p>
          </div>
          <div className="flex gap-4 text-right">
            <div><p className="text-2xl font-bold">{tabEntries.length}</p><p className="text-xs text-white/70">Rules</p></div>
            <div><p className="text-2xl font-bold">{tabEntries.filter(e => e.is_active).length}</p><p className="text-xs text-white/70">Active</p></div>
          </div>
        </div>
      </div>

      {/* OTP Extract: Inline Quick Test Card */}
      {activeTab === 'otp_extract' && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-green-100 rounded-lg">
              <Zap size={18} className="text-green-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Quick OTP Extraction Test</h3>
              <p className="text-xs text-gray-500">Paste any message with an OTP and see what gets extracted</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Input area */}
            <div className="lg:col-span-1">
              <label className="text-xs font-medium text-gray-600 block mb-1.5">Test Message</label>
              <Textarea
                value={quickTestMsg}
                onChange={e => setQuickTestMsg(e.target.value)}
                rows={5}
                placeholder="Paste a message containing an OTP code..."
                className="font-mono text-xs resize-y min-h-[100px]"
              />
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  size="sm"
                  icon={quickTestLoading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                  onClick={async () => {
                    if (!quickTestMsg.trim()) return;
                    setQuickTestLoading(true);
                    setQuickTestResult(null);
                    setQuickTestError('');
                    try {
                      // Get the active OTP extract rules to use their config
                      const activeRules = tabEntries.filter(e => e.is_active);
                      const otpRule = activeRules[0] || {};
                      const otpMin = otpRule.otp_length_min || 4;
                      const otpMax = otpRule.otp_length_max || 8;
                      const otpPattern = otpRule.otp_pattern || '';
                      const res: any = await translationsApi.test({
                        translation_type: 'otp_extract',
                        replace_content: otpRule.replace_content || '{{OTP}}',
                        is_otp_extract: true,
                        otp_length_min: otpMin,
                        otp_length_max: otpMax,
                        otp_pattern: otpPattern,
                        test_input: quickTestMsg,
                      });
                      if (res.success && res.data?.data) {
                        const output = res.data.data.output || quickTestMsg;
                        const otpMatch = output !== quickTestMsg ? output : '';
                        setQuickTestResult({
                          before: quickTestMsg,
                          after: output,
                          otpFound: otpMatch,
                        });
                      } else {
                        setQuickTestError(res.error || 'API returned no result');
                        setQuickTestResult({ before: quickTestMsg, after: quickTestMsg, otpFound: '' });
                      }
                    } catch (e: any) {
                      setQuickTestError(e?.message || 'Network or server error');
                      setQuickTestResult({ before: quickTestMsg, after: quickTestMsg, otpFound: '' });
                    }
                    setQuickTestLoading(false);
                  }}
                  disabled={!quickTestMsg.trim() || quickTestLoading}
                  className="bg-green-600 hover:bg-green-700 text-white border-green-600"
                >
                  {quickTestLoading ? 'Testing...' : 'Send Test SMS'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setQuickTestMsg('Your verification code is 482931. Do not share it with anyone.');
                    setQuickTestResult(null);
                  }}
                >
                  Pre-fill Sample
                </Button>
              </div>
            </div>

            {/* Result display */}
            <div className="lg:col-span-2">
              {quickTestResult ? (
                <div className="space-y-3">
                  <ComparisonRow label="Message" before={quickTestResult.before} after={quickTestResult.after} multiline />
                  {quickTestResult.otpFound ? (
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                      <Check size={16} className="text-green-600 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-green-800">OTP Extracted: <code className="bg-green-200 px-1.5 py-0.5 rounded text-green-900 font-bold">{quickTestResult.otpFound}</code></p>
                        <p className="text-xs text-green-600 mt-0.5">This is what will be forwarded to the supplier. The full message is preserved in SMS logs.</p>
                      </div>
                    </div>
                  ) : quickTestResult.before !== quickTestResult.after ? (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <AlertCircle size={16} className="text-blue-600 flex-shrink-0" />
                      <p className="text-sm text-blue-700">Message was transformed but no OTP digits were identified. Check your OTP length range (4-8 digits).</p>
                    </div>
                  ) : quickTestError ? (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                      <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
                      <p className="text-sm text-red-700">Test failed: {quickTestError}</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
                      <p className="text-sm text-amber-700">No transformation applied. Make sure at least one OTP Extract rule is <strong>active</strong> and the message contains a {(() => { const r = tabEntries.filter(e => e.is_active)[0] || {}; return `${r.otp_length_min || 4}-${r.otp_length_max || 8}`; })()} digit number.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full min-h-[140px] border-2 border-dashed border-gray-200 rounded-lg">
                  <div className="text-center py-6">
                    <MessageSquare size={28} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-400">Paste a message and click <strong>Send Test SMS</strong></p>
                    <p className="text-xs text-gray-400 mt-1">to see the OTP extraction result</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Number Prefix: Inline Quick Test Card */}
      {activeTab === 'number_prefix' && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-amber-100 rounded-lg">
              <Zap size={18} className="text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Quick Number Translation Test</h3>
              <p className="text-xs text-gray-500">Paste a destination number and see how strip/add prefix transforms it</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1">
              <label className="text-xs font-medium text-gray-600 block mb-1.5">Test Destination Number</label>
              <input
                type="text"
                value={npTestDest}
                onChange={e => setNpTestDest(e.target.value)}
                placeholder="008801712345678"
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              />
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  size="sm"
                  icon={npTestLoading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                  onClick={async () => {
                    if (!npTestDest.trim()) return;
                    setNpTestLoading(true);
                    setNpTestResult(null);
                    setNpTestError('');
                    try {
                      const activeRules = tabEntries.filter(e => e.is_active);
                      const rule = activeRules[0] || {};
                      const res: any = await translationsApi.test({
                        translation_type: 'number_prefix',
                        test_destination: npTestDest,
                        strip_prefix_digits: rule.strip_prefix_digits || 0,
                        add_prefix_text: rule.add_prefix_text || '',
                      });
                      if (res.success && res.data?.data) {
                        const output = res.data.data.destination || res.data.data.output || npTestDest;
                        setNpTestResult({ before: npTestDest, after: output });
                      } else {
                        setNpTestError(res.error || 'API returned no result');
                        setNpTestResult({ before: npTestDest, after: npTestDest });
                      }
                    } catch (e: any) {
                      setNpTestError(e?.message || 'Network or server error');
                      setNpTestResult({ before: npTestDest, after: npTestDest });
                    }
                    setNpTestLoading(false);
                  }}
                  disabled={!npTestDest.trim() || npTestLoading}
                  className="bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                >
                  {npTestLoading ? 'Testing...' : 'Test Translation'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setNpTestDest('008801712345678');
                    setNpTestResult(null);
                    setNpTestError('');
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>

            <div className="lg:col-span-2">
              {npTestResult ? (
                <div className="space-y-3">
                  <ComparisonRow label="Destination" before={npTestResult.before} after={npTestResult.after} />
                  {npTestResult.before !== npTestResult.after ? (
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                      <Check size={16} className="text-green-600 flex-shrink-0" />
                      <p className="text-sm text-green-700">Number transformed: <code className="bg-green-200 px-1.5 py-0.5 rounded text-green-900 font-bold">{npTestResult.after}</code></p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
                      <p className="text-sm text-amber-700">No active rules applied. Create a Number Translation rule first.</p>
                    </div>
                  )}
                  {npTestError && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                      <AlertCircle size={16} className="text-red-600" />
                      <p className="text-sm text-red-700">{npTestError}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full min-h-[100px] border-2 border-dashed border-gray-200 rounded-lg">
                  <div className="text-center py-6">
                    <Hash size={28} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-400">Paste a number and click <strong>Test Translation</strong></p>
                    <p className="text-xs text-gray-400 mt-1">to see strip/add prefix transformation</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* SID Alias: Inline Quick Test Card */}
      {activeTab === 'sid_alias' && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 bg-pink-100 rounded-lg">
              <Zap size={18} className="text-pink-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Quick SID Alias Test</h3>
              <p className="text-xs text-gray-500">Paste a sender ID and see if it matches a wildcard pattern</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1">
              <label className="text-xs font-medium text-gray-600 block mb-1.5">Test Sender ID</label>
              <input
                type="text"
                value={saTestSid}
                onChange={e => setSaTestSid(e.target.value)}
                placeholder="TECHCORP1"
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              />
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  size="sm"
                  icon={saTestLoading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                  onClick={async () => {
                    if (!saTestSid.trim()) return;
                    setSaTestLoading(true);
                    setSaTestResult(null);
                    setSaTestError('');
                    try {
                      const activeRules = tabEntries.filter(e => e.is_active);
                      const rule = activeRules[0] || {};
                      const res: any = await translationsApi.test({
                        translation_type: 'sid_alias',
                        test_sender_id: saTestSid,
                        source_pattern: rule.source_pattern || '',
                        target_value: rule.target_value || '',
                      });
                      if (res.success && res.data?.data) {
                        const output = res.data.data.sender_id || res.data.data.output || saTestSid;
                        setSaTestResult({ before: saTestSid, after: output });
                      } else {
                        setSaTestError(res.error || 'API returned no result');
                        setSaTestResult({ before: saTestSid, after: saTestSid });
                      }
                    } catch (e: any) {
                      setSaTestError(e?.message || 'Network or server error');
                      setSaTestResult({ before: saTestSid, after: saTestSid });
                    }
                    setSaTestLoading(false);
                  }}
                  disabled={!saTestSid.trim() || saTestLoading}
                  className="bg-pink-600 hover:bg-pink-700 text-white border-pink-600"
                >
                  {saTestLoading ? 'Testing...' : 'Test Translation'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSaTestSid('TECHCORP1');
                    setSaTestResult(null);
                    setSaTestError('');
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>

            <div className="lg:col-span-2">
              {saTestResult ? (
                <div className="space-y-3">
                  <ComparisonRow label="Sender ID" before={saTestResult.before} after={saTestResult.after} />
                  {saTestResult.before !== saTestResult.after ? (
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                      <Check size={16} className="text-green-600 flex-shrink-0" />
                      <p className="text-sm text-green-700">Sender ID matched: <code className="bg-green-200 px-1.5 py-0.5 rounded text-green-900 font-bold">{saTestResult.after}</code></p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
                      <p className="text-sm text-amber-700">No pattern matched. Create an active SID Alias rule or try a different sender ID.</p>
                    </div>
                  )}
                  {saTestError && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                      <AlertCircle size={16} className="text-red-600" />
                      <p className="text-sm text-red-700">{saTestError}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full min-h-[100px] border-2 border-dashed border-gray-200 rounded-lg">
                  <div className="text-center py-6">
                    <AtSign size={28} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-400">Paste a sender ID and click <strong>Test Translation</strong></p>
                    <p className="text-xs text-gray-400 mt-1">to see pattern matching and replacement</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* SID Random: MCCMNC-to-SID Mapping Table */}
      {activeTab === 'sid_random' && (
        <>
          {/* MCCMNC → SID Mapping Table */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Shuffle size={20} className="text-purple-600" />
                  MCCMNC → SID Mapping
                </h3>
                <div className="flex items-center gap-2 mt-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
                  <span className="text-2xl">👆</span>
                  <p className="text-xs text-purple-700">
                    <strong>How it works:</strong> Find a country/operator below, type the sender ID you want to use, and click <strong>Save All Mappings</strong>. The platform will automatically use that SID for SMS sent to that destination.
                  </p>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Assign a specific sender ID to each MCCMNC. When an SMS is sent to a destination matching that MCCMNC, the assigned SID is used.
                  <span className="ml-2 font-semibold text-purple-600">
                    {Object.values(mccmncSidMap).filter(v => v.trim()).length} of {mccmnc.length} mapped
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw size={14} />}
                  onClick={() => { setMccmncSidLoaded(false); loadSidMappings(); }}
                >
                  Refresh
                </Button>
                <Button
                  size="sm"
                  icon={mccmncSidSaving ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                  onClick={saveAllSidMappings}
                  disabled={mccmncSidSaving}
                >
                  {mccmncSidSaving ? 'Saving...' : 'Save All Mappings'}
                </Button>
              </div>
            </div>

            {/* Search + pagination */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by country, operator, MCC, MNC..."
                  value={mccmncSidSearch}
                  onChange={e => { setMccmncSidSearch(e.target.value); setMccmncSidPage(0); }}
                  className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm"
                />
              </div>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                Page {mccmncSidPage + 1} of {Math.max(1, Math.ceil((mccmnc.filter(m => !mccmncSidSearch || m.country?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || m.operator?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || (m.mcc + m.mnc).includes(mccmncSidSearch)).length / mccmncSidPerPage)))}
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600 uppercase tracking-wider">
                    <th className="p-2 w-8">#</th>
                    <th className="p-2">Country</th>
                    <th className="p-2">Operator</th>
                    <th className="p-2 w-16 text-center">MCC</th>
                    <th className="p-2 w-16 text-center">MNC</th>
                    <th className="p-2">Assigned SID</th>
                    <th className="p-2 w-20 text-center">Status</th>
                    <th className="p-2 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {mccmnc
                    .filter(m => !mccmncSidSearch || m.country?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || m.operator?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || (m.mcc + m.mnc).includes(mccmncSidSearch))
                    .slice(mccmncSidPage * mccmncSidPerPage, (mccmncSidPage + 1) * mccmncSidPerPage)
                    .map((m, idx) => {
                      const mid = String(m.id);
                      const currentSid = mccmncSidMap[mid] || '';
                      const isMapped = !!currentSid.trim();
                      return (
                        <tr key={m.id} className={`border-b border-gray-100 hover:bg-purple-50/30 transition-colors ${isMapped ? 'bg-green-50/30' : ''}`}>
                          <td className="p-2 text-gray-400">{mccmncSidPage * mccmncSidPerPage + idx + 1}</td>
                          <td className="p-2 font-medium text-gray-700">{m.country}</td>
                          <td className="p-2 text-gray-600 max-w-[150px] truncate" title={m.operator}>{m.operator}</td>
                          <td className="p-2 text-center font-mono text-[10px] bg-gray-100 rounded">{m.mcc}</td>
                          <td className="p-2 text-center font-mono text-[10px] bg-gray-100 rounded">{m.mnc}</td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={currentSid}
                              onChange={e => setMccmncSidMap(p => ({ ...p, [mid]: e.target.value }))}
                              placeholder={isMapped ? '' : 'Set SID...'}
                              className={`w-full px-2 py-1.5 border rounded text-xs font-mono transition-colors
                                ${isMapped ? 'bg-green-50 border-green-300 text-green-800 font-semibold' : 'bg-white border-gray-200 hover:border-purple-300 focus:border-purple-500'}`}
                            />
                          </td>
                          <td className="p-2 text-center">
                            {isMapped ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span> Mapped
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-400">—</span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {isMapped && (
                              <button
                                onClick={() => clearSidMapping(mid)}
                                className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                                title="Clear SID"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Pagination controls */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <span className="text-xs text-gray-500">
                Showing {Math.min(mccmncSidPerPage, (mccmnc.filter(m => !mccmncSidSearch || m.country?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || m.operator?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || (m.mcc + m.mnc).includes(mccmncSidSearch)).length - mccmncSidPage * mccmncSidPerPage))} of {mccmnc.filter(m => !mccmncSidSearch || m.country?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || m.operator?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || (m.mcc + m.mnc).includes(mccmncSidSearch)).length} MCCMNCs
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" disabled={mccmncSidPage === 0} onClick={() => setMccmncSidPage(p => Math.max(0, p - 1))}>Prev</Button>
                <Button size="sm" variant="secondary" disabled={(mccmncSidPage + 1) * mccmncSidPerPage >= mccmnc.filter(m => !mccmncSidSearch || m.country?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || m.operator?.toLowerCase().includes(mccmncSidSearch.toLowerCase()) || (m.mcc + m.mnc).includes(mccmncSidSearch)).length} onClick={() => setMccmncSidPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          </Card>

          {/* SID Random Rules (general pool, non-MCCMNC) */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-gray-700">General SID Pool Rules (non-MCCMNC)</h3>
              <span className="text-xs text-gray-500">{tabEntries.filter(e => !e.mccmnc_list || (Array.isArray(e.mccmnc_list) && e.mccmnc_list.length === 0)).length} rules</span>
            </div>
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Search rules..." value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm" />
              </div>
              {tabEntries.length > 0 && (
                <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={deleteAll}>Delete All</Button>
              )}
            </div>
          </Card>
          {renderTable()}
        </>
      )}

      {/* Non-SID-Random tabs: normal layout */}
      {activeTab !== 'sid_random' && (
        <>
          <Card>
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Search rules..." value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm" />
              </div>
              {tabEntries.length > 0 && (
                <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={deleteAll}>Delete All</Button>
              )}
            </div>
          </Card>
          {renderTable()}
        </>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? `Edit ${TAB_CONFIG[activeTab].label}` : `Add ${TAB_CONFIG[activeTab].label}`} size="lg" footer={
        <div className="flex justify-between w-full">
          <Button variant="secondary" size="sm" icon={<Eye size={14} />} onClick={() => { setShowPreview(!showPreview); if (!showPreview) schedulePreview(); }} className={showPreview ? 'ring-2 ring-yellow-400' : ''}>{showPreview ? 'Hide Preview' : 'Preview'}</Button>
          <Button variant="secondary" size="sm" icon={<Play size={14} />} onClick={() => {
            setTestInput('Your verification code is 123456. Do not share.');
            setTestSenderId('SENDER1');
            setTestDestination('008801712345678');
            setTestOutput('');
            setShowTestModal(true);
          }}>Test</Button>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? 'Update' : 'Create'}</Button>
          </div>
        </div>
      }>
        {renderFormFields()}
      </Modal>

      {/* Live Preview Panel — inline in add/edit modal */}
      {showModal && showPreview && (
        <div className="mt-6 border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-yellow-500" />
              <h3 className="font-semibold text-sm text-gray-700">Live Preview</h3>
              {previewLoading && <RefreshCw size={14} className="animate-spin text-blue-500" />}
            </div>
            <div className="flex items-center gap-2">
              {(activeTab === 'number_prefix' || activeTab === 'sid_alias') && (
                activeTab === 'number_prefix' ? (
                  <input type="text" value={previewInput.destination} onChange={e => setPreviewInput(p => ({ ...p, destination: e.target.value }))}
                    className="px-2 py-1 border rounded text-xs w-40 font-mono" placeholder="Destination" />
                ) : (
                  <input type="text" value={previewInput.sender_id} onChange={e => setPreviewInput(p => ({ ...p, sender_id: e.target.value }))}
                    className="px-2 py-1 border rounded text-xs w-32 font-mono" placeholder="Sender ID" />
                )
              )}
              {(activeTab === 'content_replace' || activeTab === 'otp_extract' || activeTab === 'random_content') && (
                <input type="text" value={previewInput.message} onChange={e => setPreviewInput(p => ({ ...p, message: e.target.value }))}
                  className="px-2 py-1 border rounded text-xs flex-1 min-w-0 font-mono" placeholder="Sample message..." />
              )}
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-gray-100 rounded" title="Close preview">
                <X size={14} className="text-gray-400" />
              </button>
            </div>
          </div>

          {previewError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-600 flex items-center gap-2">
              <AlertCircle size={14} /> {previewError}
            </div>
          ) : previewOutput ? (
            <div className="space-y-2">
              {/* Destination comparison */}
              {(activeTab === 'number_prefix') && previewOutput.destination !== undefined && (
                <ComparisonRow label="Destination" before={previewInput.destination} after={previewOutput.destination || ''} />
              )}
              {/* Sender ID comparison */}
              {activeTab === 'sid_alias' && previewOutput.sender_id !== undefined && (
                <ComparisonRow label="Sender ID" before={previewInput.sender_id} after={previewOutput.sender_id || ''} />
              )}
              {/* Message comparison */}
              {(activeTab === 'content_replace' || activeTab === 'otp_extract' || activeTab === 'random_content') && previewOutput.message !== undefined && (
                <ComparisonRow label="Message" before={previewInput.message} after={previewOutput.message || ''} multiline />
              )}
              {/* sid_random shows output */}
              {activeTab === 'sid_random' && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <p className="text-xs text-purple-600 mb-1 font-medium">Random SID (from pool)</p>
                  <code className="text-sm font-bold text-purple-800">{previewOutput.sender_id || (previewOutput as any).output || '—'}</code>
                  <p className="text-[10px] text-purple-500 mt-1">Refreshes each call — click form field to re-randomize</p>
                </div>
              )}
            </div>
          ) : previewLoading ? (
            <div className="flex items-center justify-center py-4 text-sm text-gray-400 gap-2">
              <RefreshCw size={14} className="animate-spin" /> Processing...
            </div>
          ) : (
            <div className="text-center py-4 text-xs text-gray-400">Fill in sample input above to see the preview</div>
          )}
        </div>
      )}

      {/* Test Modal */}
      <Modal isOpen={showTestModal} onClose={() => setShowTestModal(false)} title="Test Translation" size="lg" footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowTestModal(false)}>Close</Button>
        </div>
      }>
        <div className="space-y-4">
          {(activeTab === 'number_prefix' || activeTab === 'sid_alias') && (
            <>
              {activeTab === 'number_prefix' && <Input label="Test Destination" value={testDestination} onChange={e => setTestDestination(e.target.value)} placeholder="008801712345678" />}
              {activeTab === 'sid_alias' && <Input label="Test Sender ID" value={testSenderId} onChange={e => setTestSenderId(e.target.value)} placeholder="TECHCORP1" />}
            </>
          )}
          {(activeTab === 'content_replace' || activeTab === 'otp_extract' || activeTab === 'random_content') && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Test Message</label>
              <Textarea value={testInput} onChange={e => setTestInput(e.target.value)} rows={3} placeholder="Your code is 123456. Do not share." />
            </div>
          )}
          <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={testTrans}>Apply Translation</Button>
          {testOutput && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-xs text-green-600 font-medium mb-1">Result</p>
              {(activeTab === 'number_prefix' || activeTab === 'sid_alias') ? (
                <div className="space-y-1">
                  <p className="font-semibold text-green-800">{activeTab === 'number_prefix' ? testDestOutput || testOutput : testSidOutput || testOutput}</p>
                  {testDestOutput && <p className="text-xs text-green-600">Destination: {testDestOutput}</p>}
                  {testSidOutput && <p className="text-xs text-green-600">Sender ID: {testSidOutput}</p>}
                </div>
              ) : (
                <p className="font-semibold text-green-800">{testOutput}</p>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal isOpen={showImportModal} onClose={() => setShowImportModal(false)} title={`Import ${TAB_CONFIG[activeTab].label} CSV`} size="lg" footer={
        <div className="flex justify-between w-full">
          <Button variant="secondary" icon={<Download size={14} />} onClick={downloadSample}>Download Sample</Button>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowImportModal(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={!importText.trim() || importLoading}>
              {importLoading ? <RefreshCw size={14} className="animate-spin mr-1" /> : <Upload size={14} className="mr-1" />}
              Import & Replace All
            </Button>
          </div>
        </div>
      }>
        <div className="space-y-4">
          <div className="bg-blue-50 p-3 rounded-lg text-xs">
            <p className="font-medium text-blue-700 mb-1">CSV Format:</p>
            <code className="text-blue-600">{TAB_CONFIG[activeTab].csvHeaders}</code>
            <p className="text-blue-600 mt-1">⚠ Import deletes ALL existing rules of this type first.</p>
          </div>
          {/* Drag & drop zone */}
          <div
            ref={dropZoneRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
              ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <GripVertical size={32} className="mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-gray-600">Drag & drop CSV file here</p>
            <p className="text-xs text-gray-400 mt-1">or click to browse</p>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
          </div>
          <Textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={8}
            placeholder="Paste CSV data here..."
            className="font-mono text-xs"
          />
          {importResult && (
            <div className={`p-3 rounded-lg text-sm ${importResult.errors?.length > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
              <div className="flex items-center gap-2">
                {importResult.errors?.length > 0 ? <AlertCircle size={16} className="text-yellow-600" /> : <Check size={16} className="text-green-600" />}
                <span className="font-medium">{importResult.created} rules imported</span>
              </div>
              {importResult.errors?.map((e: any, i: number) => (
                <p key={i} className="text-xs text-red-600 mt-1">{typeof e === 'string' ? e : e.error}</p>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
