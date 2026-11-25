import { useEffect, useMemo, useState } from 'react';
import { PageTitle } from '../components/ui';
import { useApp } from '../store/AppContext';
import { apiEnabled, apiRequest } from '../utils/api';

const labelFor = (key: string) => ({ relationshipStatus: 'Rating', relationshipRating: 'Rating', bdOwner: 'Owner', owner: 'Owner', nextFollowUpAt: 'Next follow-up', nextAction: 'Next action', status: 'Status', fullName: 'Name', candidateName: 'Candidate', positionsRequested: 'Positions requested', meetingLevel: 'Meeting level', monthlyBillRate: 'Monthly bill rate', feePerHire: 'Fee per hire', actualRateOrFee: 'Actual rate or fee', expectedMarginPercent: 'Expected margin', actualMarginPercent: 'Actual margin', id: 'Position ID', recordId: 'Record ID', workLocation: 'Work location', keySkills: 'Key skills', durationMonths: 'Duration' }[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase()));
function formatValue(value?: string, action = '') {
  if (!value) return '—';
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, item]) => `${labelFor(key)}: ${item == null || item === '' ? '—' : typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)}`).join('\n');
    }
  } catch { /* Plain text audit value. */ }
  if (action.toLowerCase().includes('rating') && !value.includes(':')) return `Rating: ${value}`;
  return value;
}
function formatTimestamp(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}:00+05:30` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function AuditPage() {
  const { auditEntries, canAdmin, setAuditEntries } = useApp();
  const [query, setQuery] = useState('');
  useEffect(() => { if (apiEnabled && canAdmin) void apiRequest<Array<Record<string, unknown>>>('/api/audit').then(entries => setAuditEntries(entries.map(entry => ({ id: String(entry.id), user: String(entry.user), action: String(entry.action), entityType: String(entry.entityType), recordId: String(entry.record ?? ''), previousValue: String(entry.oldValue ?? ''), newValue: String(entry.newValue ?? ''), timestamp: String(entry.createdAt) })))).catch(() => undefined); }, [canAdmin]);
  const rows = useMemo(() => auditEntries.filter(entry => `${entry.user} ${entry.action} ${entry.entityType} ${entry.recordId}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [auditEntries, query]);
  if (!canAdmin) return <section className="card p-6"><h1 className="text-xl font-semibold">Administrator access required</h1><p className="mt-2 text-muted">The audit history is only available to the Administrator role.</p></section>;
  return <div><PageTitle title="Audit history" sub={apiEnabled ? 'Server recorded activity is read-only and administrator-only.' : 'View the sample changes recorded in this browser demo.'} /><input className="input mb-4 max-w-md" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search user, action, or record" /><div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted"><th className="p-3">User</th><th className="p-3">Action</th><th className="p-3">Record</th><th className="p-3">Before</th><th className="p-3">After</th><th className="p-3">Date and time (IST)</th></tr></thead><tbody>{rows.map(entry => <tr className="border-b align-top" key={entry.id}><td className="p-3">{entry.user}</td><td className="p-3">{entry.action}</td><td className="p-3">{entry.entityType} · {entry.recordId}</td><td className="max-w-sm whitespace-pre-wrap break-words p-3 text-xs leading-5">{formatValue(entry.previousValue, entry.action)}</td><td className="max-w-sm whitespace-pre-wrap break-words p-3 text-xs leading-5">{formatValue(entry.newValue, entry.action)}</td><td className="min-w-40 whitespace-nowrap p-3">{formatTimestamp(entry.timestamp)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-5 text-sm text-muted">No matching audit entries.</p>}</div></div>;
}
