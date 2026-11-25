import { FancySelect } from '../components/FancySelect';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageTitle, statusColor, VendorBadge } from '../components/ui';
import { useApp } from '../store/AppContext';
import { LOCATIONS, RELATIONSHIP_STATUSES } from '../types';
import type { Contact, RelationshipStatus } from '../types';
import { downloadCsv } from '../utils/csv';
import { ApiError, apiDownload, apiEnabled, apiRequest } from '../utils/api';

const builtInViews = ['All', 'My Contacts', 'Hot Contacts', 'No Activity in 30 Days', 'By Practice'];
interface SavedView { id?: string; name: string; baseView: string; query: string; sort: string; ratingFilter?: string }

export default function Contacts() {
  const { contacts, setContacts, canEdit, canAdmin, userName, role, addAudit, accounts, users, refreshFromApi, lookups, notify } = useApp();
  const locations = lookups.Location?.length ? lookups.Location : LOCATIONS;
  const ratings = lookups.RelationshipRating?.length ? lookups.RelationshipRating as RelationshipStatus[] : RELATIONSHIP_STATUSES;
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [view, setView] = useState('All');
  const [ratingFilter, setRatingFilter] = useState(searchParams.get('status') || '');
  const [sort, setSort] = useState('fullName');
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => { if (apiEnabled) return []; try { const stored = JSON.parse(localStorage.getItem('bdcrm-saved-views') || '[]') as Array<string | SavedView>; return stored.filter((item): item is SavedView => typeof item !== 'string'); } catch { return []; } });
  const [draft, setDraft] = useState({ fullName: '', designation: '', account: accounts[0]?.name || 'NTT DATA', vertical: '', reportsTo: '', orgLevel: '', location: 'Bangalore', email: '', phone: '', relationshipStatus: 'Cold' as RelationshipStatus, bdOwner: userName, routeViaVendor: false });
  const allowed = role === 'User' ? contacts.filter(contact => contact.bdOwner === userName) : contacts;
  useEffect(() => { if (apiEnabled) void apiRequest<SavedView[]>('/api/contact-views').then(setSavedViews).catch(error => setMessage(error instanceof Error ? error.message : 'Saved views could not be loaded.')); }, []);
  const today = new Date();
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 30);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const filtered = useMemo(() => allowed.filter(contact => {
    const savedView = savedViews.find(item => item.name === view);
    const baseView = savedView?.baseView || view;
    const matchesView = baseView === 'All' || baseView === 'My Contacts' && contact.bdOwner === userName || baseView === 'Hot Contacts' && contact.relationshipStatus === 'Hot' || baseView === 'No Activity in 30 Days' && (!contact.lastContact || contact.lastContact < cutoffDay) || baseView === 'By Practice' && (!savedView?.query || contact.vertical.toLowerCase().includes(savedView.query.toLowerCase()));
    return matchesView && (!ratingFilter || contact.relationshipStatus === ratingFilter) && `${contact.fullName} ${contact.designation} ${contact.account} ${contact.vertical} ${contact.location} ${contact.email}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => { const savedSort = savedViews.find(item => item.name === view)?.sort || sort; return String(a[savedSort as keyof Contact] || '').localeCompare(String(b[savedSort as keyof Contact] || '')); }), [allowed, view, userName, query, sort, cutoffDay, savedViews, ratingFilter]);

  async function saveView(event: React.FormEvent) {
    event.preventDefault();
    const name = viewName.trim();
    if (!name) { notify('Enter a name for this view.', 'error'); return; }
    const previous = savedViews.find(item => item.name === name);
    const nextView: SavedView = { ...previous, name, baseView: previous?.baseView || (savedViews.some(item => item.name === view) ? savedViews.find(item => item.name === view)!.baseView : view), query, sort, ratingFilter };
    if (apiEnabled) {
      try {
        const saved = await apiRequest<SavedView>(previous?.id ? `/api/contact-views/${previous.id}` : '/api/contact-views', { method: previous?.id ? 'PUT' : 'POST', body: JSON.stringify(nextView) });
        const next = [...savedViews.filter(item => item.name !== name), saved]; setSavedViews(next); setView(name); setMessage('Saved view is available in your account.'); setSaveViewOpen(false); setViewName(''); notify('View saved.');
      } catch (error) { const message = error instanceof Error ? error.message : 'Saved view could not be stored.'; setMessage(message); notify(message, 'error'); }
      return;
    }
    const next = [...savedViews.filter(item => item.name !== name), nextView];
    try { localStorage.setItem('bdcrm-saved-views', JSON.stringify(next)); setSavedViews(next); setView(name); setSaveViewOpen(false); setViewName(''); notify('View saved in this browser.'); }
    catch { notify('This browser could not save the view. Check its storage settings.', 'error'); }
  }

  async function deleteSavedView(item: SavedView) {
    if (apiEnabled && item.id) {
      try { await apiRequest(`/api/contact-views/${item.id}`, { method: 'DELETE' }); }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Saved view could not be deleted.'); return; }
    }
    const next = savedViews.filter(view => view.name !== item.name); setSavedViews(next);
    if (!apiEnabled) localStorage.setItem('bdcrm-saved-views', JSON.stringify(next));
    if (view === item.name) { setView('All'); setQuery(''); setRatingFilter(''); }
  }

  async function createContact(event: React.FormEvent) {
    event.preventDefault();
    const duplicate = contacts.find(contact => (draft.email && contact.email.toLowerCase() === draft.email.trim().toLowerCase()) || (contact.account === draft.account && contact.fullName.trim().toLowerCase() === draft.fullName.trim().toLowerCase() && contact.reportsTo === draft.reportsTo));
    const allowPossibleDuplicate = Boolean(duplicate && window.confirm(`Possible duplicate found: ${duplicate.fullName} (${duplicate.stakeholderId}). Save this contact anyway?`));
    if (duplicate && !allowPossibleDuplicate) return;
    if (apiEnabled) {
      const accountId = accounts.find(account => account.name === draft.account)?.id;
      const reportsToId = contacts.find(contact => contact.fullName === draft.reportsTo)?.id;
      if (!accountId) { setMessage('Choose an account that exists in the shared CRM.'); return; }
      try {
        const payload = { accountId, fullName: draft.fullName, designation: draft.designation || null, practice: draft.vertical || null, location: draft.location, email: draft.email || null, phone: draft.phone || null, relationshipRating: draft.relationshipStatus, ownerId: users.find(user => user.name === draft.bdOwner)?.id ?? null, reportsToId: reportsToId || null, routeViaVendorManagement: draft.routeViaVendor, allowPossibleDuplicate };
        try { await apiRequest('/api/contacts', { method: 'POST', body: JSON.stringify(payload) }); }
        catch (error) {
          if (!(error instanceof ApiError) || error.payload.duplicateWarning !== true || !window.confirm(error.message)) throw error;
          await apiRequest('/api/contacts', { method: 'POST', body: JSON.stringify({ ...payload, allowPossibleDuplicate: true }) });
        }
        await refreshFromApi(); setShowForm(false); setMessage('Contact added to the shared CRM.');
        setDraft(current => ({ ...current, fullName: '', email: '', phone: '', designation: '', vertical: '', reportsTo: '' }));
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Contact could not be saved.'); }
      return;
    }
    const contact: Contact = { ...draft, id: `c-${Date.now()}`, stakeholderId: `SH-${String(contacts.length + 1).padStart(4, '0')}`, highestStage: 'Mapped', lastContact: '', lastDiscussionTopic: '', nextAction: '', nextFollowUp: '', createdAt: new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString().slice(0, 10) };
    setContacts(previous => [contact, ...previous]);
    addAudit({ action: 'Contact created', entityType: 'Contact', recordId: contact.stakeholderId, newValue: JSON.stringify({ fullName: contact.fullName, account: contact.account, owner: contact.bdOwner, possibleDuplicateOverride: allowPossibleDuplicate }) });
    setShowForm(false); setMessage('Contact added. This demo saves it in this browser.'); setDraft(current => ({ ...current, fullName: '', email: '', phone: '', designation: '', vertical: '', reportsTo: '' }));
  }

  async function updateRating(contact: Contact, status: RelationshipStatus) {
    if (status === contact.relationshipStatus) return;
    if (apiEnabled) {
      try {
        await apiRequest(`/api/contacts/${contact.id}`, { method: 'PATCH', body: JSON.stringify({ accountId: accounts.find(item => item.name === contact.account)?.id, fullName: contact.fullName, designation: contact.designation, practice: contact.vertical, location: contact.location, email: contact.email || null, phone: contact.phone || null, relationshipRating: status, ownerId: users.find(user => user.name === contact.bdOwner)?.id ?? null, reportsToId: contacts.find(item => item.fullName === contact.reportsTo)?.id ?? null, routeViaVendorManagement: contact.routeViaVendor, expectedAnnualValue: contact.expectedAnnualValue ?? null, annualTarget: contact.annualTarget ?? null }) });
        await refreshFromApi();
      } catch (error) { window.alert(error instanceof Error ? error.message : 'Rating could not be saved.'); }
      return;
    }
    setContacts(previous => previous.map(item => item.id === contact.id ? { ...item, relationshipStatus: status } : item));
    addAudit({ action: 'Relationship rating changed', entityType: 'Contact', recordId: contact.stakeholderId, previousValue: contact.relationshipStatus, newValue: status });
  }

  async function updateOwner(contact: Contact, owner: string) {
    if (owner === contact.bdOwner) return;
    if (apiEnabled) {
      const ownerId = users.find(user => user.name === owner)?.id;
      if (!ownerId) { window.alert('Create this team member in Administration before assigning contacts.'); return; }
      try { await apiRequest(`/api/contacts/${contact.id}`, { method: 'PATCH', body: JSON.stringify({ accountId: accounts.find(item => item.name === contact.account)?.id, fullName: contact.fullName, designation: contact.designation, practice: contact.vertical, location: contact.location, email: contact.email || null, phone: contact.phone || null, relationshipRating: contact.relationshipStatus, ownerId, reportsToId: contacts.find(item => item.fullName === contact.reportsTo)?.id ?? null, routeViaVendorManagement: contact.routeViaVendor, expectedAnnualValue: contact.expectedAnnualValue ?? null, annualTarget: contact.annualTarget ?? null }) }); await refreshFromApi(); }
      catch (error) { window.alert(error instanceof Error ? error.message : 'Owner could not be changed.'); }
      return;
    }
    setContacts(previous => previous.map(item => item.id === contact.id ? { ...item, bdOwner: owner } : item));
    addAudit({ action: 'Contact owner change', entityType: 'Contact', recordId: contact.stakeholderId, previousValue: contact.bdOwner, newValue: owner });
  }

  async function exportContacts() {
    if (apiEnabled) { try { await apiDownload('/api/exports/contacts.csv', 'bd-crm-contacts.csv'); } catch (error) { window.alert(error instanceof Error ? error.message : 'Export could not be downloaded.'); } return; }
    const rows = filtered.map(contact => ({ StakeholderID: contact.stakeholderId, FullName: contact.fullName, Account: contact.account, Designation: contact.designation, Practice: contact.vertical, Location: contact.location, RelationshipRating: contact.relationshipStatus, Owner: contact.bdOwner, Email: contact.email, LastContact: contact.lastContact, NextFollowUp: contact.nextFollowUp }));
    if (downloadCsv('bd-crm-contacts.csv', rows)) { addAudit({ action: 'Contact list exported', entityType: 'Contact', recordId: `${rows.length} rows` }); notify(`Exported ${rows.length} contacts.`); }
  }

  const viewNames = [...builtInViews, ...savedViews.map(item => item.name)];
  return <div><PageTitle title="Contacts" sub="Search, filter, save views, and maintain stakeholder records." action={canEdit && <button className="btn" onClick={() => { setMessage(''); setShowForm(value => !value); }}>+ New Contact</button>} />
    {message && <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">{message}</div>}
    {showForm && <form className="card mb-4 grid gap-3 p-5 md:grid-cols-3" onSubmit={createContact}><div className="md:col-span-3"><h2 className="font-semibold">Add stakeholder</h2><p className="text-xs text-muted">Required: name, account, location, relationship rating, and owner.</p></div>
      <input className="input" required placeholder="Full name" value={draft.fullName} onChange={event => setDraft({ ...draft, fullName: event.target.value })} />
      <FancySelect className="input" value={draft.account} onChange={event => setDraft({ ...draft, account: event.target.value })}>{accounts.map(account => <option key={account.id}>{account.name}</option>)}</FancySelect>
      <input className="input" placeholder="Designation" value={draft.designation} onChange={event => setDraft({ ...draft, designation: event.target.value })} />
      <input className="input" placeholder="Practice / vertical" value={draft.vertical} onChange={event => setDraft({ ...draft, vertical: event.target.value })} />
      <FancySelect className="input" required value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })}>{locations.map(location => <option key={location}>{location}</option>)}</FancySelect>
      <input className="input" placeholder="Email" type="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} />
      <input className="input" placeholder="Phone" value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} />
      <FancySelect className="input" value={draft.relationshipStatus} onChange={event => setDraft({ ...draft, relationshipStatus: event.target.value as RelationshipStatus })}>{ratings.map(status => <option key={status}>{status}</option>)}</FancySelect>
      <FancySelect className="input" value={draft.reportsTo} onChange={event => setDraft({ ...draft, reportsTo: event.target.value })}><option value="">Top of reporting branch</option>{contacts.map(contact => <option key={contact.id}>{contact.fullName}</option>)}</FancySelect>
      <FancySelect className="input" disabled={!(canAdmin || role === 'BD Lead')} value={draft.bdOwner} onChange={event => setDraft({ ...draft, bdOwner: event.target.value })}>{[...new Set(users.filter(user => user.isActive).map(user => user.name).concat(contacts.map(contact => contact.bdOwner), userName))].map(owner => <option key={owner}>{owner}</option>)}</FancySelect>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.routeViaVendor} onChange={event => setDraft({ ...draft, routeViaVendor: event.target.checked })} /> Route via Vendor Management</label>
      <div className="flex gap-2 md:col-span-3"><button className="btn">Save contact</button><button className="btn-ghost" type="button" onClick={() => setShowForm(false)}>Cancel</button></div>
    </form>}
    <div className="mb-3 flex flex-wrap gap-2">{viewNames.map(name => { const saved = savedViews.find(item => item.name === name); return <span className="inline-flex" key={name}><button onClick={() => { setView(name); if (saved) { setQuery(saved.query); setSort(saved.sort); setRatingFilter(saved.ratingFilter || ''); }  }} className={`btn-ghost ${view === name ? '!bg-slate-100 !border-slate-300' : ''}`}>{name}</button>{saved && <button className="btn-ghost !px-2" aria-label={`Delete ${name} view`} title="Delete saved view" onClick={() => void deleteSavedView(saved)}>×</button>}</span>; })}<FancySelect className="input max-w-48" value={sort} onChange={event => setSort(event.target.value)}><option value="fullName">Sort: Name</option><option value="account">Sort: Account</option><option value="location">Sort: Location</option><option value="relationshipStatus">Sort: Rating</option><option value="bdOwner">Sort: Owner</option></FancySelect><FancySelect className="input max-w-44" value={ratingFilter} onChange={event => setRatingFilter(event.target.value)}><option value="">All ratings</option>{ratings.map(rating => <option key={rating}>{rating}</option>)}</FancySelect><button className="btn-ghost" onClick={() => { setViewName(''); setSaveViewOpen(true); }}>Save view</button><button className="btn-ghost" onClick={exportContacts}>Export CSV</button><input className="input ml-auto max-w-xs" placeholder="Search contacts..." value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted">{['Stakeholder ID', 'Full Name', 'Designation', 'Account', 'Practice', 'Location', 'Rating', 'BD Owner', 'Last Contact', 'Next Follow-up'].map(header => <th className="p-3 font-medium" key={header}>{header}</th>)}</tr></thead><tbody>{filtered.map(contact => <tr key={contact.id} className="border-b hover:bg-slate-50"><td className="p-3">{contact.stakeholderId}</td><td className="p-3 font-medium"><Link className="text-primary" to={`/contacts/${contact.id}`}>{contact.fullName}</Link>{contact.routeViaVendor && <VendorBadge />}</td><td className="p-3">{contact.designation}</td><td className="p-3">{contact.account}</td><td className="p-3">{contact.vertical}</td><td className="p-3">{contact.location}</td><td className="p-3">{canEdit ? <FancySelect aria-label={`Rating for ${contact.fullName}`} className={`badge ${statusColor(contact.relationshipStatus)}`} value={contact.relationshipStatus} onChange={event => updateRating(contact, event.target.value as RelationshipStatus)}>{ratings.map(status => <option key={status}>{status}</option>)}</FancySelect> : <span className={`badge ${statusColor(contact.relationshipStatus)}`}>{contact.relationshipStatus}</span>}</td><td className="p-3">{canAdmin || role === 'BD Lead' ? <FancySelect className="input min-w-36" value={contact.bdOwner} onChange={event => updateOwner(contact, event.target.value)}>{[...new Set(users.filter(user => user.isActive).map(user => user.name).concat(contacts.map(item => item.bdOwner)))].map(owner => <option key={owner}>{owner}</option>)}</FancySelect> : contact.bdOwner}</td><td className="p-3">{contact.lastContact || '—'}</td><td className="p-3">{contact.nextFollowUp || '—'}</td></tr>)}</tbody></table>{filtered.length === 0 && <p className="p-5 text-sm text-muted">No contacts match this view.</p>}</div>
    <p className="mt-3 text-xs text-muted">{filtered.length} {filtered.length === 1 ? 'record' : 'records'} shown · {apiEnabled ? 'shared CRM data' : 'demo edits saved in this browser'}.</p>
    {saveViewOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSaveViewOpen(false); }}><form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="save-view-title" onSubmit={saveView}><div className="modal-heading"><div><div className="import-eyebrow">CONTACTS</div><h2 id="save-view-title">Save this view</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setSaveViewOpen(false)}>×</button></div><p className="text-sm text-muted">Save the current search, filters, and sort order for quick access.</p><label className="block text-sm font-medium">View name<input className="input mt-2 w-full" autoFocus value={viewName} onChange={event => setViewName(event.target.value)} placeholder="e.g. Hot accounts in Mumbai" maxLength={50} required /></label><div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setSaveViewOpen(false)}>Cancel</button><button className="btn" type="submit">Save view</button></div></form></div>}
  </div>;
}
