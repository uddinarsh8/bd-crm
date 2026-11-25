import { useState } from 'react';
import { ArrowRight, Check, CircleAlert, Download, FileSpreadsheet, ShieldCheck, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { PageTitle } from '../components/ui';
import { useApp } from '../store/AppContext';
import { LOCATIONS, RELATIONSHIP_STATUSES } from '../types';
import type { Contact, RelationshipStatus } from '../types';
import { apiEnabled, apiRequest } from '../utils/api';

interface ImportRow { [key: string]: string | undefined; __row: string; __kind: 'New' | 'Updated' | 'Rejected'; __error?: string }
const templateColumns = ['Stakeholder ID', 'Account', 'Full Name', 'Designation', 'Vertical / Practice', 'Location', 'Email', 'Phone', 'Relationship Status', 'BD Owner', 'Reports To', 'Route via Vendor Management'];

function normaliseDate(value: string | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const iso = value.match(/^\d{4}-\d{2}-\d{2}$/);
  if (iso) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

export default function ImportPage() {
  const { contacts, setContacts, accounts, canEdit, role, userName, addAudit, refreshFromApi, lookups, notify } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [summary, setSummary] = useState<{ created: number; updated: number } | null>(null);

  function choose(selected?: File) { if (!selected) return; setFile(selected); setRows([]); setError(''); setConfirmed(false); setSummary(null); }

  async function chooseSample(name: string) {
    try {
      const response = await fetch(`/sample-imports/${name}`);
      if (!response.ok) throw new Error('Sample file could not be loaded.');
      const blob = await response.blob(); choose(new File([blob], name, { type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      notify('Sample file loaded. Select “Review uploaded file” to preview it.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Sample file could not be loaded.', 'error'); }
  }

  async function review() {
    if (!file) return;
    setBusy(true); setError('');
    try {
      let records: Record<string, string>[];
      if (file.name.toLowerCase().endsWith('.csv')) {
        records = await new Promise((resolve, reject) => Papa.parse<Record<string, string>>(file, { header: true, skipEmptyLines: true, complete: result => resolve(result.data), error: reject }));
      } else {
        const { default: ExcelJS } = await import('exceljs');
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await file.arrayBuffer());
        const sheet = workbook.worksheets[0]; if (!sheet) throw new Error('No worksheet found.');
        const headers: string[] = []; sheet.getRow(1).eachCell((cell, column) => { headers[column - 1] = String(cell.value || '').trim(); });
        records = [];
        sheet.eachRow((row, rowNumber) => { if (rowNumber === 1) return; const record: Record<string, string> = {}; headers.forEach((header, index) => { if (header) record[header] = String(row.getCell(index + 1).text || '').trim(); }); records.push(record); });
      }
      const required = ['Account', 'Full Name', 'Designation', 'Vertical / Practice', 'Location', 'Relationship Status', 'BD Owner', 'Route via Vendor Management'];
      const statuses = (lookups.RelationshipRating?.length ? lookups.RelationshipRating : RELATIONSHIP_STATUSES) as string[]; const locations = (lookups.Location?.length ? lookups.Location : LOCATIONS) as string[]; const seenIds = new Set<string>(); const seenEmails = new Set<string>();
      const checked = records.map((record, index): ImportRow => {
        const issues: string[] = [];
        const missing = required.filter(field => !record[field]?.trim()); if (missing.length) issues.push(`Missing: ${missing.join(', ')}`);
        if (!accounts.some(account => account.name.toLowerCase() === (record.Account || '').toLowerCase())) issues.push('Unknown account');
        if (record['Relationship Status'] && !statuses.includes(record['Relationship Status'])) issues.push('Unknown relationship status');
        if (record.Location && !locations.includes(record.Location)) issues.push('Unknown location');
        if (record['Route via Vendor Management'] && !['Yes', 'No'].includes(record['Route via Vendor Management'])) issues.push('Vendor route must be Yes or No');
        if (role === 'User' && record['BD Owner'] !== userName) issues.push('Users can import only their own contacts');
        const email = (record.Email || '').trim().toLowerCase(); const stakeholderId = (record['Stakeholder ID'] || '').trim();
        if (stakeholderId && seenIds.has(stakeholderId)) issues.push('Duplicate Stakeholder ID in this file');
        if (email && seenEmails.has(email)) issues.push('Duplicate email in this file');
        if (stakeholderId) seenIds.add(stakeholderId); if (email) seenEmails.add(email);
        const accountName = (record.Account || '').trim().toLowerCase();
        const managerName = (record['Reports To'] || '').trim().toLowerCase();
        const duplicateName = contacts.find(contact => contact.account.trim().toLowerCase() === accountName && contact.fullName.trim().toLowerCase() === (record['Full Name'] || '').trim().toLowerCase() && (contact.reportsTo || '').trim().toLowerCase() === managerName);
        const existing = contacts.find(contact => (stakeholderId && contact.stakeholderId === stakeholderId) || (email && contact.email.toLowerCase() === email));
        if (duplicateName && duplicateName.id !== existing?.id) issues.push(`Possible duplicate contact: ${duplicateName.fullName}`);
        return { ...record, __row: String(index + 2), __kind: issues.length ? 'Rejected' : existing ? 'Updated' : 'New', __error: issues.join('; ') || undefined };
      });
      setRows(checked); setConfirmed(false); setSummary(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read this file. Please use the CRM XLSX or CSV template.'); }
    finally { setBusy(false); }
  }

  const counts = { New: rows.filter(row => row.__kind === 'New').length, Updated: rows.filter(row => row.__kind === 'Updated').length, Rejected: rows.filter(row => row.__kind === 'Rejected').length };

  async function confirmImport() {
    const validRows = rows.filter(row => row.__kind !== 'Rejected');
    if (!validRows.length) return;
    if (apiEnabled) {
      setBusy(true);
      try {
        const result = await apiRequest<{ created: number; updated: number; rejected: Array<{ row: string; errors: string[] }> }>('/api/import/contacts', { method: 'POST', body: JSON.stringify({ fileName: file?.name || 'contact-import', rows: validRows.map(row => ({ stakeholderId: row['Stakeholder ID'] || null, account: row.Account || '', fullName: row['Full Name'] || '', designation: row.Designation || null, practice: row['Vertical / Practice'] || null, location: row.Location || '', email: row.Email || null, phone: row.Phone || null, relationshipStatus: row['Relationship Status'] || '', bdOwner: row['BD Owner'] || null, reportsTo: row['Reports To'] || null, routeViaVendorManagement: row['Route via Vendor Management'] === 'Yes' })) }) });
        await refreshFromApi();
        const errorsByIdentity = new Map(result.rejected.map(item => [item.row, item.errors.join('; ')]));
        setRows(current => current.map(row => { const key = row['Stakeholder ID'] || row['Full Name'] || ''; const rowError = errorsByIdentity.get(key); return rowError ? { ...row, __kind: 'Rejected', __error: rowError } : row; }));
        setSummary({ created: result.created, updated: result.updated }); setConfirmed(true); notify(`Import saved: ${result.created} new, ${result.updated} updated.`);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'The import could not be saved.'); }
      finally { setBusy(false); }
      return;
    }
    const updatedRows: Contact[] = [];
    for (const row of validRows) {
      const email = (row.Email || '').trim().toLowerCase();
      const current = contacts.find(contact => (row['Stakeholder ID'] && contact.stakeholderId === row['Stakeholder ID']) || (email && contact.email.toLowerCase() === email));
      const base: Contact = current || { id: `c-${Date.now()}-${updatedRows.length}`, stakeholderId: row['Stakeholder ID'] || `SH-${String(contacts.length + updatedRows.length + 1).padStart(4, '0')}`, account: row.Account || '', fullName: row['Full Name'] || '', designation: '', vertical: '', orgLevel: '', location: '', email: '', phone: '', relationshipStatus: 'Cold', bdOwner: userName, routeViaVendor: false, lastContact: '', lastDiscussionTopic: '', nextAction: '', nextFollowUp: '', highestStage: 'Mapped', createdAt: new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString().slice(0, 10) };
      updatedRows.push({ ...base, stakeholderId: row['Stakeholder ID'] || base.stakeholderId, account: row.Account || base.account, fullName: row['Full Name'] || base.fullName, designation: row.Designation || base.designation, vertical: row['Vertical / Practice'] || base.vertical, location: row.Location || base.location, email: email || base.email, phone: row.Phone || base.phone, relationshipStatus: (row['Relationship Status'] as RelationshipStatus) || base.relationshipStatus, bdOwner: row['BD Owner'] || base.bdOwner, reportsTo: row['Reports To'] || base.reportsTo, routeViaVendor: row['Route via Vendor Management'] === 'Yes', updatedAt: new Date().toISOString().slice(0, 10) });
    }
    setContacts(current => [...updatedRows.filter(row => !current.some(contact => contact.id === row.id)), ...current.map(contact => updatedRows.find(row => row.id === contact.id) || contact)]);
    const created = updatedRows.filter(row => !contacts.some(contact => contact.id === row.id)).length;
    const updated = updatedRows.length - created;
    setSummary({ created, updated }); setConfirmed(true); notify(`Import saved: ${created} new, ${updated} updated in this browser.`);
    addAudit({ action: 'Contact import confirmed', entityType: 'Import', recordId: file?.name || 'Uploaded file', newValue: JSON.stringify({ created, updated, rejected: counts.Rejected }) });
  }

  async function downloadRejected() {
    const rejected = rows.filter(row => row.__kind === 'Rejected').map(row => ({ ...Object.fromEntries(templateColumns.map(column => [column, row[column] || ''])), 'Import Error': row.__error || '' }));
    if (!rejected.length) return;
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Rejected contacts');
    const columns = [...templateColumns, 'Import Error'];
    sheet.columns = columns.map(header => ({ header, key: header, width: Math.max(18, header.length + 3) }));
    rejected.forEach(row => sheet.addRow(row));
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a'); link.href = url; link.download = 'bd-crm-rejected-rows.xlsx'; link.click(); URL.revokeObjectURL(url);
  }

  return <div className="import-page"><div className="import-heading"><div><div className="import-eyebrow">DATA MANAGEMENT</div><h1>Bring your data into BD CRM</h1><p>Upload a contact file, review row results, and confirm valid records.</p></div><div className="import-promise"><ShieldCheck size={17} /><span><b>You stay in control</b><small>Review before confirming</small></span></div></div>
    <div className="import-layout"><section className="import-main-card"><div className="import-section-heading"><div className="import-step-tag">01</div><div><h2>Upload a contact file</h2><p>Use the template columns. Matching uses Stakeholder ID first, then email.</p></div></div>
      <label htmlFor="contact-import-file" className={`import-dropzone ${file ? 'has-file' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose(event.dataTransfer.files?.[0]); }}><span className="upload-icon"><Upload size={20} /></span><b>{file?.name || 'Drop your file here, or browse'}</b><span>{file ? `${(file.size / 1024).toFixed(1)} KB · Ready to review` : 'Select an Excel or CSV file from your computer'}</span><span className="browse-file">{file ? 'Choose another file' : 'Browse files'}</span><input id="contact-import-file" type="file" accept=".xlsx,.csv" onChange={event => choose(event.target.files?.[0])} /></label>
      {error && <div className="import-error"><CircleAlert size={15} />{error}</div>}
      {file && <div className="review-action"><span><b>Ready to review</b><small>No contact is changed until you confirm.</small></span><button type="button" className="btn import-confirm" disabled={busy} onClick={review}>{busy ? 'Reading file...' : 'Review uploaded file'} <ArrowRight size={15} /></button></div>}
      {!!rows.length && <div className="import-preview"><div className="preview-heading"><div><div className="import-eyebrow">{confirmed ? 'IMPORT SUMMARY' : 'FILE REVIEW'}</div><h3>{confirmed ? 'Import completed' : 'Review these records'}</h3></div><span className="preview-demo-tag">{file?.name}</span></div><p>{confirmed ? `${summary?.created} new and ${summary?.updated} updated records were saved${apiEnabled ? ' to the shared CRM' : ' in this browser'}.` : 'Rejected rows need correction. Valid rows can be saved while rejected rows are downloaded separately.'}</p>
        <div className="preview-counts"><div><b>{confirmed ? summary?.created : counts.New}</b><span>New records</span></div><div><b>{confirmed ? summary?.updated : counts.Updated}</b><span>Updates</span></div><div className="rejected-count"><b>{counts.Rejected}</b><span>Rejected rows</span></div></div>
        <div className="import-review-table"><table><thead><tr><th>Row</th><th>Contact</th><th>Account</th><th>Owner</th><th>Review result</th></tr></thead><tbody>{rows.map(row => <tr key={row.__row}><td>{row.__row}</td><td>{row['Full Name'] || '—'}</td><td>{row.Account || '—'}</td><td>{row['BD Owner'] || '—'}</td><td><span className={`review-kind kind-${row.__kind.toLowerCase()}`}>{row.__kind}</span>{row.__error && <small className="review-error-text">{row.__error}</small>}</td></tr>)}</tbody></table></div>
        {!confirmed && counts.Rejected > 0 && <button type="button" className="btn-ghost mt-3" onClick={() => void downloadRejected()}><Download size={14} /> Download rejected rows</button>}
        {!confirmed && <button type="button" className="btn import-confirm mt-3" disabled={counts.New + counts.Updated === 0 || !canEdit} onClick={confirmImport}>Confirm {counts.New + counts.Updated} valid records <ArrowRight size={15} /></button>}
        {confirmed && <div className="import-success"><Check size={16} /><span><b>{apiEnabled ? 'Import saved to the shared CRM' : 'Import saved in this browser'}</b><small>{counts.Rejected ? `${counts.Rejected} rejected rows remain available to download.` : 'All valid rows were confirmed.'}</small></span></div>}
      </div>}
    </section><aside className="import-aside"><section className="template-card"><div className="template-icon"><FileSpreadsheet size={19} /></div><div className="import-eyebrow">START WITH THE TEMPLATE</div><h2>Get the import template</h2><p>Use the standard contact columns to keep records consistent.</p><a className="template-download" href="/sample-imports/BD-CRM-Contact-Import-Template.xlsx" download><Download size={16} /> Download Excel template</a><div className="sample-downloads"><b>Try a sample file</b><button type="button" onClick={() => void chooseSample('BD-CRM-Sample-New-Contacts.xlsx')}><Download size={13} /> Load sample · 3 contact records</button><button type="button" onClick={() => void chooseSample('BD-CRM-Sample-Contact-Updates.xlsx')}><Download size={13} /> Load sample · 2 contact records</button></div></section><section className="import-rules-card"><div className="rules-heading"><ShieldCheck size={17} /><h3>Import checks</h3></div><p className="text-sm text-muted">Missing fields, unknown accounts, duplicate rows, and unsupported dropdown values are flagged before confirmation. The import never deletes a contact.</p></section></aside></div>
  </div>;
}
