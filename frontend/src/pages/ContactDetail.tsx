import { FancySelect } from '../components/FancySelect';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { statusColor, VendorBadge } from '../components/ui';
import { useApp } from '../store/AppContext';
import { DEMO_USERS, LOCATIONS, RELATIONSHIP_STATUSES, STAGES } from '../types';
import type { Contact } from '../types';
import { ApiError, apiEnabled, apiRequest } from '../utils/api';
import { currentFinancialYearRequirements, rate, scorecard } from '../utils/scorecards';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);

function ScorecardMetrics({ title, metrics, canViewMargins = true }: { title: string; metrics: ReturnType<typeof scorecard>; canViewMargins?: boolean }) {
  const values: Array<[string, string | number]> = [
    ['Requirements generated', metrics.requirementsGenerated], ['Positions joined / requested', `${metrics.positionsJoined} / ${metrics.positionsRequested}`],
    ...(canViewMargins ? [['Potential bottom line', money(metrics.potentialBottomLine)] as [string, string]] : []), ['Realised revenue', money(metrics.realisedRevenue)],
    ...(canViewMargins ? [['Realised bottom line', money(metrics.realisedBottomLine)] as [string, string]] : []), ['Fill rate', rate(metrics.fillRate)],
    ['Requirement conversion', rate(metrics.requirementConversionRate)],
  ];
  return <div><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{values.map(([label, value]) => <div className="rounded-lg bg-slate-50 p-2" key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-sm font-semibold">{value}</dd></div>)}</dl></div>;
}

export default function ContactDetail() {
  const { id } = useParams();
  const { contacts, setContacts, activities, requirements, canEdit, role, userName, addAudit, accounts, users, refreshFromApi, lookups, setRecentContactIds } = useApp();
  const locations = lookups.Location?.length ? lookups.Location : LOCATIONS;
  const ratings = lookups.RelationshipRating?.length ? lookups.RelationshipRating : RELATIONSHIP_STATUSES;
  const contact = contacts.find(item => item.id === id);
  const [draft, setDraft] = useState<Contact | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!id) return;
    setRecentContactIds(previous => [id, ...previous.filter(contactId => contactId !== id)].slice(0, 8));
    if (apiEnabled) void apiRequest(`/api/contacts/${id}/view`, { method: 'POST' }).catch(() => undefined);
  }, [id]);
  const current = draft || contact;
  const mine = activities.filter(activity => activity.contactIds.includes(id || '')).sort((a, b) => b.date.localeCompare(a.date));
  const contactRequirements = requirements.filter(requirement => requirement.raisedByContactId === id || requirement.raisedBy === contact?.fullName);
  const directReports = contacts.filter(item => item.reportsTo === contact?.fullName);
  const requirementsFor = (personIds: Set<string>) => requirements.filter(requirement => personIds.has(requirement.raisedByContactId || '') || [...personIds].some(personId => contacts.find(item => item.id === personId)?.fullName === requirement.raisedBy));
  const subtree = useMemo(() => {
    const ids = new Set<string>(id ? [id] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const person of contacts) if (person.reportsTo && [...ids].some(parentId => contacts.find(item => item.id === parentId)?.fullName === person.reportsTo) && !ids.has(person.id)) { ids.add(person.id); changed = true; }
    }
    return ids;
  }, [contacts, id]);
  const branchRequirements = requirementsFor(subtree);
  const fiscalStart = currentFinancialYearRequirements(contactRequirements);
  const contactCurrentYear = scorecard(fiscalStart);
  const contactAllTime = scorecard(contactRequirements);
  const branchCurrentYear = scorecard(currentFinancialYearRequirements(branchRequirements));
  const branchAllTime = scorecard(branchRequirements);
  const branchContacts = contacts.filter(item => subtree.has(item.id));
  const accountContacts = new Set(contacts.filter(item => item.account === contact?.account).map(item => item.id));
  const accountRequirements = requirementsFor(accountContacts);
  const accountCurrentYear = scorecard(currentFinancialYearRequirements(accountRequirements));
  const accountAllTime = scorecard(accountRequirements);
  const accountPeople = contacts.filter(item => accountContacts.has(item.id));

  if (!contact || !current) return <p>Contact not found.</p>;
  if (role === 'User' && contact.bdOwner !== userName) return <div className="card p-6"><h1 className="text-xl font-semibold">This contact isn’t in your portfolio</h1><p className="mt-2 text-muted">Users can view and update contacts assigned to them.</p><Link className="btn mt-4 inline-flex" to="/contacts">Back to contacts</Link></div>;

  async function saveContact(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !contact) return;
    const duplicate = contacts.find(item => item.id !== draft.id && ((draft.email && item.email.toLowerCase() === draft.email.toLowerCase()) || (item.account === draft.account && item.fullName.trim().toLowerCase() === draft.fullName.trim().toLowerCase() && item.reportsTo === draft.reportsTo)));
    const allowPossibleDuplicate = Boolean(duplicate && window.confirm(`Possible duplicate: ${duplicate.fullName} (${duplicate.stakeholderId}). Save these changes anyway?`));
    if (duplicate && !allowPossibleDuplicate) return;
    if (apiEnabled) {
      const accountId = accounts.find(item => item.name === draft.account)?.id;
      if (!accountId) { setMessage('This contact account is unavailable in the shared CRM.'); return; }
      try {
        const payload = { accountId, fullName: draft.fullName, designation: draft.designation, practice: draft.vertical, location: draft.location, email: draft.email || null, phone: draft.phone || null, relationshipRating: draft.relationshipStatus, ownerId: users.find(user => user.name === draft.bdOwner)?.id ?? null, reportsToId: contacts.find(item => item.fullName === draft.reportsTo)?.id ?? null, routeViaVendorManagement: draft.routeViaVendor, expectedAnnualValue: draft.expectedAnnualValue ?? null, annualTarget: draft.annualTarget ?? null, allowPossibleDuplicate };
        try { await apiRequest(`/api/contacts/${draft.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
        catch (error) {
          if (!(error instanceof ApiError) || error.payload.duplicateWarning !== true || !window.confirm(error.message)) throw error;
          await apiRequest(`/api/contacts/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ ...payload, allowPossibleDuplicate: true }) });
        }
        await refreshFromApi(); setDraft(null); setMessage('Contact changes saved to the shared CRM.');
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Contact changes could not be saved.'); }
      return;
    }
    setContacts(previous => previous.map(item => item.id === draft.id ? { ...draft, updatedAt: new Date().toISOString().slice(0, 10) } : item));
    addAudit({ action: 'Contact updated', entityType: 'Contact', recordId: draft.stakeholderId, previousValue: JSON.stringify({ fullName: contact.fullName, relationshipStatus: contact.relationshipStatus, bdOwner: contact.bdOwner }), newValue: JSON.stringify({ fullName: draft.fullName, relationshipStatus: draft.relationshipStatus, bdOwner: draft.bdOwner }) });
    setDraft(null); setMessage('Contact changes saved in this browser.');
  }

  const field = (label: string, key: keyof Contact, options?: string[]) => <label className="block text-sm" key={String(key)}><span className="mb-1 block text-muted">{label}</span>{options ? <FancySelect className="input" value={String(current[key] || '')} onChange={event => setDraft({ ...current, [key]: event.target.value } as Contact)}>{options.map(option => <option key={option}>{option}</option>)}</FancySelect> : <input className="input" value={String(current[key] || '')} onChange={event => setDraft({ ...current, [key]: event.target.value } as Contact)} />}</label>;

  return <div className="space-y-4">
    <section className="card p-5 md:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs uppercase tracking-wide text-muted">{contact.stakeholderId} · {contact.account}</div><h1 className="mt-1 text-2xl font-bold">{contact.fullName}{contact.routeViaVendor && <VendorBadge />}</h1><p className="mt-1 text-muted">{contact.designation} · {contact.vertical} · {contact.location}</p></div><span className={`badge ${statusColor(contact.relationshipStatus)}`}>{contact.relationshipStatus}</span></div>
      <div className="mt-5"><div className="flex items-center justify-between text-xs"><span className="text-muted">Relationship progress</span><b>{contact.highestStage}</b></div><div className="mt-2 grid grid-cols-7 gap-1">{STAGES.map((stage, index) => <div key={stage}><div className={`h-1.5 rounded-full ${index <= Math.max(0, STAGES.indexOf(contact.highestStage)) ? 'bg-[#ff3d8b]' : 'bg-slate-200'}`} /><span className="mt-1 block truncate text-[10px] text-muted">{stage}</span></div>)}</div></div>
      <div className="mt-5 grid grid-cols-2 gap-4 text-sm md:grid-cols-4"><div><span className="text-muted">BD owner</span><br />{contact.bdOwner}</div><div><span className="text-muted">Last contact</span><br />{contact.lastContact || '—'}</div><div><span className="text-muted">Next follow-up</span><br />{contact.nextFollowUp || '—'}</div><div><span className="text-muted">Last discussion</span><br />{contact.lastDiscussionTopic || '—'}</div><div><span className="text-muted">Next action</span><br />{contact.nextAction || '—'}</div><div><span className="text-muted">Reports to</span><br />{contact.reportsTo || 'Top of branch'}</div><div><span className="text-muted">Direct reports</span><br />{directReports.length}</div></div>
      <div className="mt-4 flex flex-wrap gap-2"><Link className="btn" to={`/activities?contact=${contact.id}`}>Log activity</Link><Link className="btn-ghost" to="/meetings">Meetings</Link><Link className="btn-ghost" to="/requirements">Requirements</Link></div>
    </section>

    {canEdit && <details className="card p-5"><summary className="cursor-pointer font-semibold">Edit stakeholder details and annual target</summary><form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={saveContact}>
      {field('Full name', 'fullName')}{field('Designation', 'designation')}{field('Practice', 'vertical')}{field('Location', 'location', locations)}{field('Email', 'email')}{field('Phone', 'phone')}{field('Relationship rating', 'relationshipStatus', ratings)}{field('Reports to', 'reportsTo', ['', ...contacts.filter(item => item.id !== contact.id).map(item => item.fullName)])}
      {(role === 'Administrator' || role === 'BD Lead') && field('BD owner', 'bdOwner', [...new Set([...contacts.map(item => item.bdOwner), ...users.filter(user => user.isActive).map(user => user.name), ...DEMO_USERS.map(user => user.name)])])}
      <label className="block text-sm"><span className="mb-1 block text-muted">Expected annual value (INR)</span><input className="input" type="number" min="0" value={current.expectedAnnualValue || ''} onChange={event => setDraft({ ...current, expectedAnnualValue: Number(event.target.value) })} /></label>
      {role !== 'User' && <label className="block text-sm"><span className="mb-1 block text-muted">Annual target bottom line (INR)</span><input className="input" type="number" min="0" value={current.annualTarget || ''} onChange={event => setDraft({ ...current, annualTarget: Number(event.target.value) })} /></label>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={current.routeViaVendor} onChange={event => setDraft({ ...current, routeViaVendor: event.target.checked })} /> Route through Vendor Management</label>
      {message && <p className="text-sm text-muted md:col-span-3">{message}</p>}<button className="btn md:col-span-3">Save contact</button>
    </form></details>}

    <section className="card space-y-5 p-5"><div><div className="text-xs uppercase tracking-wide text-muted">Relationship scorecard · India financial year, April to March</div><div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-muted">Expected annual value</span><b className="mt-1 block text-lg">{money(contact.expectedAnnualValue || 0)}</b></div>{role !== 'User' && <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-muted">Annual target bottom line</span><b className="mt-1 block text-lg">{money(contact.annualTarget || 0)}</b></div>}{role !== 'User' && <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-muted">Target gap vs realised this FY</span><b className="mt-1 block text-lg">{money((contact.annualTarget || 0) - contactCurrentYear.realisedBottomLine)}</b></div>}</div></div>
      <div className="grid gap-5 xl:grid-cols-2"><ScorecardMetrics title="This financial year" metrics={contactCurrentYear} canViewMargins={role !== 'User'} /><ScorecardMetrics title="All time" metrics={contactAllTime} canViewMargins={role !== 'User'} /></div>
      <div className="border-t pt-4"><div className="mb-3 text-xs uppercase tracking-wide text-muted">Roll-ups</div><div className="grid gap-5 xl:grid-cols-2"><div><ScorecardMetrics title={`Reporting line (${subtree.size} people)`} metrics={branchAllTime} canViewMargins={role !== 'User'} />{role !== 'User' && <p className="mt-2 text-xs text-muted">Target {money(branchContacts.reduce((sum, person) => sum + (person.annualTarget || 0), 0))} · actual this FY {money(branchCurrentYear.realisedBottomLine)} · gap {money(branchContacts.reduce((sum, person) => sum + (person.annualTarget || 0), 0) - branchCurrentYear.realisedBottomLine)}</p>}</div><div><ScorecardMetrics title={`Account (${accountContacts.size} stakeholders)`} metrics={accountAllTime} canViewMargins={role !== 'User'} />{role !== 'User' && <p className="mt-2 text-xs text-muted">Target {money(accountPeople.reduce((sum, person) => sum + (person.annualTarget || 0), 0))} · actual this FY {money(accountCurrentYear.realisedBottomLine)} · gap {money(accountPeople.reduce((sum, person) => sum + (person.annualTarget || 0), 0) - accountCurrentYear.realisedBottomLine)}</p>}</div></div></div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2"><section className="card p-5"><h2 className="mb-3 font-semibold">Activity timeline</h2>{mine.length ? mine.map(activity => <article className="border-l-2 border-slate-300 py-2 pl-4" key={activity.id}><b>{activity.type}{activity.meetingLevel ? ` · ${activity.meetingLevel}` : ''}</b><span className="ml-2 text-xs text-muted">{activity.date}</span><p className="text-sm text-muted">{activity.summary}</p><p className="text-xs">Outcome: {activity.outcome || '—'} · Logged by {activity.loggedBy}</p></article>) : <p className="text-sm text-muted">No activities yet.</p>}</section>
      <section className="card p-5"><h2 className="mb-3 font-semibold">Requirements raised</h2>{contactRequirements.length ? contactRequirements.map(requirement => <article className="border-b py-3 last:border-0" key={requirement.id}><b>{requirement.roleTitle}</b><p className="text-sm text-muted">{requirement.reqCode} · {requirement.positions} positions · {requirement.status}</p></article>) : <p className="text-sm text-muted">No requirements linked to this stakeholder.</p>}</section>
      <section className="card p-5"><h2 className="mb-2 font-semibold">Reporting hierarchy</h2><p className="text-sm">Reports to: <b>{contact.reportsTo || 'Top of this branch'}</b></p><p className="mt-1 text-sm">Direct reports: {directReports.map(person => person.fullName).join(', ') || 'None mapped'}</p></section>
      <section className="card p-5"><h2 className="mb-2 font-semibold">Other contacts at {contact.account}</h2><div className="flex flex-wrap gap-x-3 gap-y-2 text-sm">{contacts.filter(person => person.account === contact.account && person.id !== contact.id).map(person => <Link className="text-primary" key={person.id} to={`/contacts/${person.id}`}>{person.fullName}</Link>)}</div></section>
    </div>
  </div>;
}
