import { FancySelect } from '../components/FancySelect';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageTitle } from '../components/ui';
import { useApp } from '../store/AppContext';
import type { EngagementType, PositionRecord, PositionStatus, Requirement } from '../types';
import { REQ_STATUSES } from '../types';
import { apiEnabled, apiRequest } from '../utils/api';

const TODAY = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
const engagementTypes: EngagementType[] = ['Contract', 'Permanent hire', 'Project/RPO'];
const positionStatuses: PositionStatus[] = ['Open', 'Profiles Shared', 'Interviewing', 'Offered', 'Joined', 'Dropped', 'Cancelled'];

function totals(requirement: Requirement) {
  const type = requirement.engagementType || 'Contract';
  const positions = requirement.positions || 0;
  const potential = type === 'Contract' ? positions * (requirement.monthlyBillRate || 0) * (requirement.durationMonths || 0)
    : type === 'Permanent hire' ? positions * (requirement.feePerHire || 0) : (requirement.projectValue || 0);
  const joined = (requirement.positionsData || []).filter(position => position.status === 'Joined');
  const realised = joined.reduce((sum, position) => sum + (type === 'Contract' ? position.actualRateOrFee * (requirement.durationMonths || 0)
    : type === 'Permanent hire' ? position.actualRateOrFee : (requirement.projectValue || 0) / Math.max(positions, 1)), 0);
  const realisedBottomLine = joined.reduce((sum, position) => sum + (type === 'Project/RPO' ? (requirement.projectValue || 0) / Math.max(positions, 1)
    : position.actualRateOrFee * (type === 'Contract' ? (requirement.durationMonths || 0) : 1)) * (position.actualMarginPercent || 0) / 100, 0);
  return { potential, expectedBottomLine: potential * (requirement.expectedMarginPercent || 0) / 100, joined: joined.length, realised, realisedBottomLine };
}

function deriveRequirementStatus(positions: PositionRecord[]) {
  const joined = positions.filter(position => position.status === 'Joined').length;
  const cancelled = positions.filter(position => position.status === 'Cancelled').length;
  if (joined && joined + cancelled === positions.length) return 'Closed Won';
  if (joined) return 'Partially Filled';
  if (positions.length && cancelled === positions.length) return 'Closed Lost';
  if (positions.some(position => position.status === 'Offered')) return 'Offer Made';
  if (positions.some(position => position.status === 'Interviewing')) return 'Interviews';
  if (positions.some(position => position.status === 'Profiles Shared')) return 'Profiles Shared';
  return 'New';
}

export default function RequirementsPage() {
  const { requirements, setRequirements, contacts, setContacts, activities, canEdit, role, addAudit, refreshFromApi, lookups, notify } = useApp();
  const requirementStatuses = lookups.RequirementStatus?.length ? lookups.RequirementStatus : REQ_STATUSES;
  const canApproveStatus = role === 'Administrator' || role === 'BD Lead';
  const [expanded, setExpanded] = useState('');
  const [positionDrafts, setPositionDrafts] = useState<Record<string, PositionRecord>>({});
  const [requirementDrafts, setRequirementDrafts] = useState<Record<string, Requirement>>({});
  const [marginTouched, setMarginTouched] = useState(false);
  const [marginDefaults, setMarginDefaults] = useState<Record<string, string>>({ Contract: '20', 'Permanent hire': '20', 'Project/RPO': '20' });
  const [form, setForm] = useState({ contactId: contacts[0]?.id || '', meetingId: '', roleTitle: '', keySkills: '', positions: '1', experienceRange: '', workLocation: contacts[0]?.location || 'Bangalore', engagementType: 'Contract' as EngagementType, monthlyBillRate: '', durationMonths: '12', feePerHire: '', projectValue: '', expectedMarginPercent: '20', summary: '' });
  useEffect(() => {
    if (!apiEnabled || marginTouched) return;
    void apiRequest<Record<string, unknown>>('/api/lookups').then(values => {
      const configured = values.DefaultMargins as Record<string, string> | undefined;
      if (configured) {
        setMarginDefaults(current => ({ ...current, ...configured }));
        setForm(current => ({ ...current, expectedMarginPercent: configured[current.engagementType] || current.expectedMarginPercent }));
      }
    }).catch(() => undefined);
  }, [marginTouched]);
  const meetings = activities.filter(activity => activity.type === 'Meeting (formal)' && activity.meetingLevel && activity.attendees);
  const total = useMemo(() => requirements.reduce((sum, requirement) => {
    const row = totals(requirement);
    return { potential: sum.potential + row.potential, expected: sum.expected + row.expectedBottomLine, realised: sum.realised + row.realised, realisedBottomLine: sum.realisedBottomLine + row.realisedBottomLine };
  }, { potential: 0, expected: 0, realised: 0, realisedBottomLine: 0 }), [requirements]);

  async function createRequirement(event: React.FormEvent) {
    event.preventDefault();
    const contact = contacts.find(item => item.id === form.contactId);
    const meeting = meetings.find(item => item.id === form.meetingId);
    const commercialAmount = form.engagementType === 'Contract' ? Number(form.monthlyBillRate) : form.engagementType === 'Permanent hire' ? Number(form.feePerHire) : Number(form.projectValue);
    if (!contact || !meeting || !meeting.contactIds.includes(contact.id) || !form.roleTitle.trim() || !Number.isFinite(commercialAmount) || commercialAmount <= 0 || (form.engagementType === 'Contract' && Number(form.durationMonths) < 1)) {
      window.alert('Choose the stakeholder linked to the selected formal meeting and enter a role title.');
      return;
    }
    const quantity = Math.max(1, Number(form.positions) || 1);
    if (apiEnabled) {
      try {
        await apiRequest('/api/requirements', { method: 'POST', body: JSON.stringify({ contactId: contact.id, sourceMeetingId: meeting.id, roleTitle: form.roleTitle.trim(), skills: form.keySkills, positionsRequested: quantity, experienceRange: form.experienceRange || null, workLocation: form.workLocation || null, engagementType: form.engagementType, monthlyBillRate: form.engagementType === 'Contract' ? Number(form.monthlyBillRate) : null, contractMonths: form.engagementType === 'Contract' ? Number(form.durationMonths) : null, feePerHire: form.engagementType === 'Permanent hire' ? Number(form.feePerHire) : null, projectValue: form.engagementType === 'Project/RPO' ? Number(form.projectValue) : null, expectedMarginPercent: Number(form.expectedMarginPercent), summary: form.summary.trim() }) });
        await refreshFromApi(); notify('Requirement saved.');
        setForm(current => ({ ...current, roleTitle: '', keySkills: '', positions: '1', meetingId: '', summary: '' }));
      } catch (error) { window.alert(error instanceof Error ? error.message : 'Requirement could not be saved.'); }
      return;
    }
    const positionsData: PositionRecord[] = Array.from({ length: quantity }, (_, index) => ({
      id: `pos-${Date.now()}-${index}`, candidateName: '', status: 'Open', joiningDate: '', actualRateOrFee: 0, actualMarginPercent: 0,
    }));
    const requirement: Requirement = {
      id: `req-${Date.now()}`, reqCode: `REQ-${TODAY().slice(0, 4)}-${String(requirements.length + 1).padStart(3, '0')}`,
      raisedBy: contact.fullName, raisedByContactId: contact.id, sourceMeeting: meeting.id, roleTitle: form.roleTitle.trim(),
      keySkills: form.keySkills, positions: quantity, experienceRange: form.experienceRange, workLocation: form.workLocation,
      dateReceived: TODAY(), status: 'New', bdOwner: contact.bdOwner, account: contact.account, engagementType: form.engagementType,
      monthlyBillRate: Number(form.monthlyBillRate) || 0, durationMonths: Number(form.durationMonths) || 0,
      feePerHire: Number(form.feePerHire) || 0, projectValue: Number(form.projectValue) || 0,
      expectedMarginPercent: Number(form.expectedMarginPercent) || 0, actualMarginPercent: 0, positionsData, summary: form.summary,
    };
    setRequirements(current => [requirement, ...current]);
    setContacts(current => current.map(item => item.id === contact.id ? { ...item, highestStage: 'Requirement' } : item));
    addAudit({ action: 'Requirement created', entityType: 'Requirement', recordId: requirement.reqCode, newValue: JSON.stringify({ roleTitle: requirement.roleTitle, positions: quantity, meetingId: meeting.id }) });
    notify('Requirement saved.');
    setForm(current => ({ ...current, roleTitle: '', keySkills: '', positions: '1', meetingId: '', summary: '' }));
  }

  async function changeRequirementStatus(requirement: Requirement, status: string) {
    if (status === requirement.status) return;
    if (apiEnabled) {
      try { await apiRequest(`/api/requirements/${requirement.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await refreshFromApi(); notify('Requirement stage updated.'); }
      catch (error) { window.alert(error instanceof Error ? error.message : 'Requirement status could not be saved.'); }
      return;
    }
    const nextStatus = status === 'On Hold' ? 'On Hold' : deriveRequirementStatus(requirement.positionsData || []);
    setRequirements(current => current.map(item => item.id === requirement.id ? { ...item, status: nextStatus } : item));
    addAudit({ action: 'Requirement status change', entityType: 'Requirement', recordId: requirement.reqCode, previousValue: requirement.status, newValue: nextStatus });
    notify('Requirement stage updated.');
  }

  function editRequirement(requirement: Requirement) {
    setRequirementDrafts(current => current[requirement.id] ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== requirement.id)) : ({ ...current, [requirement.id]: { ...requirement, positionsData: [...(requirement.positionsData || [])] } }));
  }

  function changeRequirementDraft(requirement: Requirement, changes: Partial<Requirement>) {
    setRequirementDrafts(current => ({ ...current, [requirement.id]: { ...(current[requirement.id] || requirement), ...changes } }));
  }

  async function saveRequirement(requirement: Requirement) {
    const draft = requirementDrafts[requirement.id];
    if (!draft) return;
    const positionsRequested = Number(draft.positions);
    const commercialAmount = draft.engagementType === 'Contract' ? Number(draft.monthlyBillRate) : draft.engagementType === 'Permanent hire' ? Number(draft.feePerHire) : Number(draft.projectValue);
    const duration = Number(draft.durationMonths);
    if (!draft.roleTitle.trim() || !Number.isInteger(positionsRequested) || positionsRequested < 1 || !Number.isFinite(commercialAmount) || commercialAmount <= 0 || (draft.engagementType === 'Contract' && (!Number.isInteger(duration) || duration < 1)) || (role !== 'User' && (!Number.isFinite(Number(draft.expectedMarginPercent)) || Number(draft.expectedMarginPercent) < 0 || Number(draft.expectedMarginPercent) > 100))) {
      window.alert('Enter a role, at least one position, and valid commercial terms. Margin must be between 0% and 100%.');
      return;
    }
    const payload = { roleTitle: draft.roleTitle.trim(), skills: draft.keySkills || null, positionsRequested: Number(draft.positions), experienceRange: draft.experienceRange || null, workLocation: draft.workLocation || null, monthlyBillRate: draft.engagementType === 'Contract' ? Number(draft.monthlyBillRate) : null, contractMonths: draft.engagementType === 'Contract' ? Number(draft.durationMonths) : null, feePerHire: draft.engagementType === 'Permanent hire' ? Number(draft.feePerHire) : null, projectValue: draft.engagementType === 'Project/RPO' ? Number(draft.projectValue) : null, expectedMarginPercent: role === 'User' ? undefined : Number(draft.expectedMarginPercent), summary: (draft.summary || '').trim() };
    if (apiEnabled) {
      try { await apiRequest(`/api/requirements/${requirement.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); await refreshFromApi(); notify('Requirement changes saved.'); }
      catch (error) { window.alert(error instanceof Error ? error.message : 'Requirement changes could not be saved.'); return; }
    } else {
      const count = Number(draft.positions);
      if (count < 1 || (draft.positionsData || []).filter(position => position.status !== 'Open').length > count) { window.alert('Position count cannot be lower than positions already in progress.'); return; }
      let positionsData = [...(draft.positionsData || [])];
      while (positionsData.length < count) positionsData.push({ id: `pos-${Date.now()}-${positionsData.length}`, candidateName: '', status: 'Open', joiningDate: '', actualRateOrFee: 0, actualMarginPercent: 0 });
      while (positionsData.length > count) { const index = positionsData.map(position => position.status).lastIndexOf('Open'); if (index < 0) break; positionsData.splice(index, 1); }
      setRequirements(current => current.map(item => item.id === requirement.id ? { ...draft, positionsData, status: item.status === 'On Hold' ? 'On Hold' : deriveRequirementStatus(positionsData) } : item));
      addAudit({ action: 'Requirement details and value updated', entityType: 'Requirement', recordId: requirement.reqCode, previousValue: JSON.stringify(requirement), newValue: JSON.stringify(draft) });
      notify('Requirement changes saved.');
    }
    setRequirementDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== requirement.id)));
  }

  async function updatePosition(requirement: Requirement, index: number, changes: Partial<PositionRecord>) {
    const before = requirement.positionsData?.[index];
    const positionsData = [...(requirement.positionsData || [])];
    if (!positionsData[index]) return;
    positionsData[index] = { ...positionsData[index], ...changes };
    if (apiEnabled) {
      const position = positionsData[index];
      const status = (changes.status === 'Dropped' ? 'Dropped' : position.status).replace(' ', '');
      try { await apiRequest(`/api/requirements/${requirement.id}/positions/${position.id}`, { method: 'PATCH', body: JSON.stringify({ status, candidateName: position.candidateName || null, joiningDate: position.joiningDate || null, actualRateOrFee: position.actualRateOrFee ?? null, actualMarginPercent: role === 'User' ? undefined : position.actualMarginPercent ?? null }) }); await refreshFromApi(); setPositionDrafts(previous => { const next = { ...previous }; delete next[position.id]; return next; }); notify('Position details saved.'); }
      catch (error) { window.alert(error instanceof Error ? error.message : 'Position update could not be saved.'); }
      return;
    }
    if (positionsData[index].status === 'Dropped') positionsData[index] = { ...positionsData[index], status: 'Open', candidateName: '', joiningDate: '', actualRateOrFee: 0, actualMarginPercent: 0 };
    const joined = positionsData.filter(position => position.status === 'Joined').length;
    const resolved = joined + positionsData.filter(position => position.status === 'Cancelled').length;
    const allFilled = joined > 0 && resolved === positionsData.length;
    const allDropped = joined === 0 && positionsData.every(position => position.status === 'Cancelled');
    const status = requirement.status === 'On Hold' ? 'On Hold' : allFilled ? 'Closed Won' : allDropped ? 'Closed Lost' : joined > 0 ? 'Partially Filled' : deriveRequirementStatus(positionsData);
    setRequirements(current => current.map(item => item.id === requirement.id ? { ...item, positionsData, status } : item));
    setPositionDrafts(previous => { const next = { ...previous }; delete next[positionsData[index].id]; return next; });
    addAudit({ action: changes.status === 'Dropped' ? 'Candidate dropped; position reopened' : 'Position fulfilment updated', entityType: 'Requirement', recordId: requirement.reqCode, previousValue: JSON.stringify(before), newValue: JSON.stringify(positionsData[index]) });
    notify('Position details saved.');
  }

  function editPosition(position: PositionRecord, changes: Partial<PositionRecord>) {
    setPositionDrafts(previous => ({ ...previous, [position.id]: { ...(previous[position.id] || position), ...changes } }));
  }

  const stakeholders = contacts.map(contact => {
    const rows = requirements.filter(requirement => requirement.raisedByContactId === contact.id);
    const requested = rows.reduce((sum, row) => sum + row.positions, 0);
    const joined = rows.reduce((sum, row) => sum + totals(row).joined, 0);
    return { contact, rows, requested, joined, potential: rows.reduce((sum, row) => sum + totals(row).potential, 0), realised: rows.reduce((sum, row) => sum + totals(row).realised, 0) };
  }).filter(row => row.rows.length > 0);

  const estimate = form.engagementType === 'Contract' ? Number(form.positions) * Number(form.monthlyBillRate) * Number(form.durationMonths)
    : form.engagementType === 'Permanent hire' ? Number(form.positions) * Number(form.feePerHire) : Number(form.projectValue);

  return <div className="requirements-page">
    <PageTitle title="Requirements" sub="Track each role from the stakeholder meeting through fulfilment." action={<span className="admin-demo-pill">{requirements.length} REQUIREMENTS</span>} />

    <div className="grid gap-3 md:grid-cols-4 mb-5">
      {[["Potential revenue", total.potential], ...(role === 'User' ? [] : [["Expected bottom line", total.expected] as [string, number]]), ["Realised revenue", total.realised], ...(role === 'User' ? [] : [["Realised bottom line", total.realisedBottomLine] as [string, number]])].map(([label, value]) => <div className="card p-4" key={String(label)}><div className="text-xs uppercase tracking-wide text-muted">{label}</div><b className="mt-2 block text-xl">{money(Number(value))}</b></div>)}
    </div>

    {canEdit && <details className="card mb-5 p-5"><summary className="cursor-pointer font-semibold">+ Add a requirement</summary>
      <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={createRequirement}>
        <FancySelect className="input" required value={form.contactId} onChange={event => { const contact = contacts.find(item => item.id === event.target.value); setForm(current => ({ ...current, contactId: event.target.value, workLocation: contact?.location || current.workLocation })); }}><option value="">Stakeholder who raised it</option>{contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.fullName} · {contact.account}</option>)}</FancySelect>
        <FancySelect className="input" required value={form.meetingId} onChange={event => setForm(current => ({ ...current, meetingId: event.target.value }))}><option value="">Source formal meeting</option>{meetings.map(meeting => <option key={meeting.id} value={meeting.id}>{meeting.date} · {meeting.meetingLevel} · {contacts.find(contact => meeting.contactIds.includes(contact.id))?.fullName || 'Stakeholder'}</option>)}</FancySelect>
        <input className="input" required placeholder="Role title" value={form.roleTitle} onChange={event => setForm(current => ({ ...current, roleTitle: event.target.value }))} />
        <input className="input" placeholder="Key skills" value={form.keySkills} onChange={event => setForm(current => ({ ...current, keySkills: event.target.value }))} />
        <input className="input" required type="number" min="1" placeholder="Positions requested" value={form.positions} onChange={event => setForm(current => ({ ...current, positions: event.target.value }))} />
        <input className="input" placeholder="Experience range" value={form.experienceRange} onChange={event => setForm(current => ({ ...current, experienceRange: event.target.value }))} />
        <FancySelect className="input" value={form.engagementType} onChange={event => { const engagementType = event.target.value as EngagementType; setForm(current => ({ ...current, engagementType, expectedMarginPercent: marginDefaults[engagementType] || current.expectedMarginPercent })); setMarginTouched(false); }}>{engagementTypes.map(type => <option key={type}>{type}</option>)}</FancySelect>
        <input className="input" placeholder="Work location" value={form.workLocation} onChange={event => setForm(current => ({ ...current, workLocation: event.target.value }))} />
        {form.engagementType === 'Contract' && <><input className="input" type="number" min="0" placeholder="Monthly bill rate (INR)" value={form.monthlyBillRate} onChange={event => setForm(current => ({ ...current, monthlyBillRate: event.target.value }))} /><input className="input" type="number" min="1" placeholder="Contract duration (months)" value={form.durationMonths} onChange={event => setForm(current => ({ ...current, durationMonths: event.target.value }))} /></>}
        {form.engagementType === 'Permanent hire' && <input className="input" type="number" min="0" placeholder="Fee per hire (INR)" value={form.feePerHire} onChange={event => setForm(current => ({ ...current, feePerHire: event.target.value }))} />}
        {form.engagementType === 'Project/RPO' && <input className="input" type="number" min="0" placeholder="Total project value (INR)" value={form.projectValue} onChange={event => setForm(current => ({ ...current, projectValue: event.target.value }))} />}
        {role === 'User' ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-muted">The administrator’s {form.engagementType.toLowerCase()} margin default will be applied.</p> : <input className="input" type="number" min="0" max="100" placeholder="Expected margin %" value={form.expectedMarginPercent} onChange={event => { setMarginTouched(true); setForm(current => ({ ...current, expectedMarginPercent: event.target.value })); }} />}
        <textarea className="input md:col-span-2" maxLength={250} placeholder="Requirement summary (max 250 characters)" value={form.summary} onChange={event => setForm(current => ({ ...current, summary: event.target.value }))} />
        <div className="md:col-span-2 rounded-lg bg-slate-50 p-3 text-sm text-muted">Potential revenue estimate: <b>{money(estimate)}</b>. Amounts are indicative and shown in INR.</div>
        <button className="btn md:col-span-2">Save requirement</button>
      </form>
    </details>}

    <div className="requirements-board">{requirementStatuses.map(status => {
      const items = requirements.filter(requirement => requirement.status === status);
      return <section className="requirement-column" key={status}><div className="requirement-column-head"><span>{status}</span><b>{items.length}</b></div><div className="requirement-cards">{items.map(requirement => {
        const summary = totals(requirement);
        return <article className="requirement-card" key={requirement.id}>
          <button className="w-full text-left" onClick={() => setExpanded(expanded === requirement.id ? '' : requirement.id)}><div className="requirement-card-code">{requirement.reqCode}<span>{requirement.positions} positions</span></div><h3>{requirement.roleTitle}</h3><p>{requirement.account} <i /> {requirement.workLocation}</p><div className="requirement-raised">Raised by <b>{requirement.raisedBy}</b></div><div className="mt-2 text-xs text-muted">{requirement.engagementType || 'Contract'} · Potential {money(summary.potential)} · Joined {summary.joined}/{requirement.positions}</div></button>
          {canApproveStatus && <FancySelect aria-label={`Put ${requirement.reqCode} on hold or resume`} className="input requirement-status mt-2" value={requirement.status === 'On Hold' ? 'On Hold' : 'Resume'} onChange={event => changeRequirementStatus(requirement, event.target.value)}><option value="Resume">{requirement.status === 'On Hold' ? 'Resume to derived stage' : `Stage: ${requirement.status} (from positions)`}</option>{requirement.status !== 'On Hold' && <option value="On Hold">Put on hold</option>}</FancySelect>}
          {expanded === requirement.id && createPortal(<div className="requirement-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setExpanded(''); }}><section className="requirement-detail-panel" role="dialog" aria-modal="true" aria-label={`Requirement ${requirement.reqCode}`}><div className="requirement-detail-heading"><div><div className="import-eyebrow">{requirement.reqCode} · {requirement.account}</div><h2>{requirement.roleTitle}</h2><p>{requirement.positions} positions · {requirement.workLocation} · Raised by {requirement.raisedBy}</p></div><button className="icon-button" aria-label="Close requirement details" onClick={() => setExpanded('')}>×</button></div><div className="mt-4 space-y-4"><div className="grid grid-cols-2 gap-3 text-sm">{role !== 'User' && <span>Expected bottom line <b>{money(summary.expectedBottomLine)}</b></span>}<span>Realised revenue <b>{money(summary.realised)}</b></span>{role !== 'User' && <span>Realised bottom line <b>{money(summary.realisedBottomLine)}</b></span>}<span>Source meeting <b>{activities.find(activity => activity.id === requirement.sourceMeeting)?.meetingLevel || requirement.sourceMeeting}</b></span></div>
            {canEdit && <><button type="button" className="btn-ghost" onClick={() => editRequirement(requirement)}>{requirementDrafts[requirement.id] ? 'Cancel requirement edit' : 'Edit requirement and value'}</button>{requirementDrafts[requirement.id] && (() => { const draft = requirementDrafts[requirement.id]; return <div className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-2"><input className="input" aria-label="Role title" value={draft.roleTitle} onChange={event => changeRequirementDraft(requirement, { roleTitle: event.target.value })} /><input className="input" aria-label="Key skills" value={draft.keySkills} placeholder="Key skills" onChange={event => changeRequirementDraft(requirement, { keySkills: event.target.value })} /><input className="input" type="number" min="1" aria-label="Positions requested" value={draft.positions} onChange={event => changeRequirementDraft(requirement, { positions: Number(event.target.value) })} /><input className="input" aria-label="Experience range" value={draft.experienceRange} placeholder="Experience range" onChange={event => changeRequirementDraft(requirement, { experienceRange: event.target.value })} /><input className="input" aria-label="Work location" value={draft.workLocation} placeholder="Work location" onChange={event => changeRequirementDraft(requirement, { workLocation: event.target.value })} />{draft.engagementType === 'Contract' && <><input className="input" type="number" min="0.01" aria-label="Monthly bill rate in INR" value={draft.monthlyBillRate} onChange={event => changeRequirementDraft(requirement, { monthlyBillRate: Number(event.target.value) })} /><input className="input" type="number" min="1" aria-label="Contract duration in months" value={draft.durationMonths} onChange={event => changeRequirementDraft(requirement, { durationMonths: Number(event.target.value) })} /></>}{draft.engagementType === 'Permanent hire' && <input className="input" type="number" min="0.01" aria-label="Fee per hire in INR" value={draft.feePerHire} onChange={event => changeRequirementDraft(requirement, { feePerHire: Number(event.target.value) })} />}{draft.engagementType === 'Project/RPO' && <input className="input" type="number" min="0.01" aria-label="Total project value in INR" value={draft.projectValue} onChange={event => changeRequirementDraft(requirement, { projectValue: Number(event.target.value) })} />}{role !== 'User' && <input className="input" type="number" min="0" max="100" aria-label="Expected margin percent" value={draft.expectedMarginPercent} onChange={event => changeRequirementDraft(requirement, { expectedMarginPercent: Number(event.target.value) })} />}<textarea className="input sm:col-span-2" maxLength={250} aria-label="Requirement summary" value={draft.summary} onChange={event => changeRequirementDraft(requirement, { summary: event.target.value })} /><button className="btn sm:col-span-2" type="button" onClick={() => void saveRequirement(requirement)}>Save requirement changes</button></div>; })()}</>}
            <div className="space-y-2">{(requirement.positionsData || []).map((position, index) => { const edit = positionDrafts[position.id] || position; return <div className="rounded-lg border p-2" key={position.id}><div className="text-xs font-semibold">Position {index + 1} · {edit.status}</div>{canEdit && <div className="mt-2 grid grid-cols-2 gap-2"><input className="input" placeholder="Candidate" value={edit.candidateName} onChange={event => editPosition(position, { candidateName: event.target.value })} /><FancySelect className="input" value={edit.status} onChange={event => editPosition(position, { status: event.target.value as PositionStatus })}>{positionStatuses.map(value => <option key={value}>{value}</option>)}</FancySelect>{edit.status === 'Joined' && <><input className="input" type="date" aria-label="Joining date" value={edit.joiningDate} onChange={event => editPosition(position, { joiningDate: event.target.value })} /><input className="input" type="number" min="0" aria-label="Actual rate or fee in INR" placeholder="Actual rate / fee (INR)" value={edit.actualRateOrFee || ''} onChange={event => editPosition(position, { actualRateOrFee: Number(event.target.value) })} />{role !== 'User' && <input className="input col-span-2" type="number" min="0" max="100" aria-label="Actual margin percent" placeholder="Actual margin %" value={edit.actualMarginPercent || ''} onChange={event => editPosition(position, { actualMarginPercent: Number(event.target.value) })} />}</>}<button className="btn col-span-2" disabled={!positionDrafts[position.id]} onClick={() => updatePosition(requirement, index, edit)}>Save position details</button></div>}</div>; })}</div>
          </div></section></div>, document.body)}
        </article>;
      })}{items.length === 0 && <div className="requirement-empty">No requirements here yet</div>}</div></section>;
    })}</div>

    <section className="requirement-table-section"><div className="requirement-table-heading"><div><div className="import-eyebrow">STAKEHOLDER SCORECARD</div><h2>Requirement value and fulfilment</h2></div></div><div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted border-b"><th className="p-3">Stakeholder</th><th className="p-3">Account</th><th className="p-3">Potential revenue</th><th className="p-3">Positions</th><th className="p-3">Joined</th><th className="p-3">Fill rate</th><th className="p-3">Realised revenue</th></tr></thead><tbody>{stakeholders.map(row => <tr className="border-b" key={row.contact.id}><td className="p-3 font-semibold">{row.contact.fullName}</td><td className="p-3">{row.contact.account}</td><td className="p-3">{money(row.potential)}</td><td className="p-3">{row.requested}</td><td className="p-3">{row.joined}</td><td className="p-3">{row.requested ? Math.round(row.joined / row.requested * 100) : 0}%</td><td className="p-3">{money(row.realised)}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-muted">This demo stores these entries in this browser only. Margin defaults, currency rules, and annual targets still need BD approval.</p></section>
  </div>;
}
