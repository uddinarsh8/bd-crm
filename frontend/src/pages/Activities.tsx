import { FancySelect } from '../components/FancySelect';
import { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageTitle } from '../components/ui';
import { useApp } from '../store/AppContext';
import { INTERACTION_TYPES, OUTCOMES } from '../types';
import { apiDownload, apiEnabled, apiRequest } from '../utils/api';
import { downloadCsv } from '../utils/csv';

const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const levelOrder = ['Mapped', 'Contacted', 'Connected', 'L1', 'L2', 'L3', 'Requirement'];

export default function Activities() {
  const { activities, setActivities, contacts, setContacts, tasks, setTasks, requirements, canEdit, userName, role, addAudit, refreshFromApi, lookups, notify } = useApp();
  const activityTypes = lookups.ActivityType?.length ? lookups.ActivityType : INTERACTION_TYPES;
  const activityOutcomes = lookups.ActivityOutcome?.length ? lookups.ActivityOutcome : OUTCOMES;
  const [query] = useSearchParams();
  const initialEdit = activities.find(activity => activity.id === query.get('edit'));
  const [editingId, setEditingId] = useState(initialEdit?.id || '');
  const [editingOriginal, setEditingOriginal] = useState(initialEdit || null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<typeof activities[number] | null>(null);
  const [form, setForm] = useState({ contactId: initialEdit?.contactIds[0] || query.get('contact') || contacts[0]?.id || '', date: initialEdit?.date || today(), type: initialEdit?.type || query.get('type') || 'Call', outcome: initialEdit?.outcome || 'Connected', meetingLevel: initialEdit?.meetingLevel || '', attendees: initialEdit?.attendees || '', summary: initialEdit?.summary || '', nextAction: initialEdit?.nextAction || '', nextActionDue: initialEdit?.nextActionDue || today() });
  const formal = form.type === 'Meeting (formal)';
  const permittedContacts = role === 'User' ? contacts.filter(contact => contact.bdOwner === userName) : contacts;
  const permittedIds = new Set(permittedContacts.map(contact => contact.id));
  const visibleActivities = useMemo(() => activities.filter(activity => activity.contactIds.some(id => permittedIds.has(id)))
    .filter(activity => (!typeFilter || activity.type === typeFilter) && `${activity.type} ${activity.outcome} ${activity.summary} ${activity.loggedBy} ${activity.contactIds.map(id => contacts.find(contact => contact.id === id)?.fullName || '').join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date)), [activities, permittedContacts, contacts, typeFilter, search]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (form.summary.trim().length > 250) { window.alert('Discussion summary must be 250 characters or fewer.'); return; }
    if (formal && (!form.meetingLevel || !form.attendees.trim())) { window.alert('A formal meeting needs a level and at least one attendee.'); return; }
    const contact = contacts.find(item => item.id === form.contactId);
    if (!contact || !permittedIds.has(contact.id)) { window.alert('Choose a contact in your permitted portfolio.'); return; }
    const activity = { id: editingId || `a-${Date.now()}`, date: form.date, contactIds: [contact.id], type: form.type, outcome: form.outcome, meetingLevel: form.meetingLevel || undefined, attendees: form.attendees.trim() || undefined, summary: form.summary.trim(), nextAction: form.nextAction.trim() || undefined, nextActionDue: form.nextActionDue || undefined, nextActionOwner: editingId ? editingOriginal?.nextActionOwner : userName, loggedBy: editingId ? editingOriginal?.loggedBy || userName : userName };
    if (apiEnabled) {
      if (editingId) { notify('Editing saved activities is available in the browser demo.', 'info'); return; }
      try {
        await apiRequest('/api/activities', { method: 'POST', body: JSON.stringify({ contactId: contact.id, occurredAt: `${form.date}T09:00:00+05:30`, type: form.type, outcome: form.outcome, meetingLevel: form.meetingLevel || null, attendees: form.attendees.trim() || null, summary: form.summary.trim(), nextAction: form.nextAction.trim() || null, nextActionDueAt: form.nextAction.trim() ? `${form.nextActionDue}T09:00:00+05:30` : null, nextActionOwnerId: null }) });
        await refreshFromApi(); notify('Activity saved.');
        setForm(current => ({ ...current, date: today(), summary: '', attendees: '', nextAction: '', nextActionDue: today() }));
      } catch (error) { window.alert(error instanceof Error ? error.message : 'Activity could not be saved.'); }
      return;
    }
    if (editingId) setActivities(current => current.map(item => item.id === editingId ? activity : item));
    else setActivities(current => [activity, ...current]);
    const oldStageIndex = levelOrder.indexOf(contact.highestStage);
    const nextStage = form.meetingLevel || (form.outcome === 'Connected' ? 'Connected' : 'Contacted');
    const stage = levelOrder.indexOf(nextStage) > oldStageIndex ? nextStage : contact.highestStage;
    setContacts(current => current.map(item => item.id === contact.id ? { ...item, lastContact: form.date, lastDiscussionTopic: form.summary.trim(), nextAction: form.nextAction.trim(), nextFollowUp: form.nextActionDue, highestStage: stage as typeof item.highestStage, updatedAt: today() } : item));
    if (editingId) setTasks(current => {
      const index = current.findIndex(task => task.contactId === contact.id && task.title === editingOriginal?.nextAction && task.owner === (editingOriginal?.nextActionOwner || editingOriginal?.loggedBy));
      if (index < 0) return form.nextAction.trim() ? [{ id: `t-${Date.now()}`, contactId: contact.id, title: form.nextAction.trim(), owner: userName, dueDate: form.nextActionDue || today(), status: 'Pending' }, ...current] : current;
      if (!form.nextAction.trim()) return current.filter((_, taskIndex) => taskIndex !== index);
      return current.map((task, taskIndex) => taskIndex === index ? { ...task, title: form.nextAction.trim(), dueDate: form.nextActionDue || today() } : task);
    });
    else if (form.nextAction.trim()) setTasks(current => [{ id: `t-${Date.now()}`, contactId: contact.id, title: form.nextAction.trim(), owner: userName, dueDate: form.nextActionDue || today(), status: 'Pending' }, ...current]);
    addAudit({ action: editingId ? 'Activity updated' : 'Activity logged', entityType: 'Activity', recordId: activity.id, newValue: JSON.stringify({ contact: contact.fullName, type: activity.type, outcome: activity.outcome, meetingLevel: activity.meetingLevel }) });
    notify(editingId ? 'Activity changes saved.' : 'Activity saved.'); setEditingId(''); setEditingOriginal(null);
    setForm(current => ({ ...current, date: today(), summary: '', attendees: '', nextAction: '', nextActionDue: today() }));
  }

  function editActivity(activity: typeof activities[number]) { setEditingId(activity.id); setEditingOriginal(activity); setForm({ contactId: activity.contactIds[0] || '', date: activity.date, type: activity.type, outcome: activity.outcome || 'Connected', meetingLevel: activity.meetingLevel || '', attendees: activity.attendees || '', summary: activity.summary, nextAction: activity.nextAction || '', nextActionDue: activity.nextActionDue || today() }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function deleteActivity(activity: typeof activities[number]) {
    if (requirements.some(requirement => requirement.sourceMeeting === activity.id)) { notify('This meeting is the source for a requirement and cannot be deleted.', 'error'); return; }
    setDeleteTarget(activity);
  }
  function confirmDeleteActivity() {
    if (!deleteTarget) return;
    setActivities(current => current.filter(item => item.id !== deleteTarget.id)); addAudit({ action: 'Activity deleted', entityType: 'Activity', recordId: deleteTarget.id, previousValue: JSON.stringify({ date: deleteTarget.date, type: deleteTarget.type, summary: deleteTarget.summary }) }); notify('Activity deleted.');
    if (editingId === deleteTarget.id) { setEditingId(''); setEditingOriginal(null); }
    setDeleteTarget(null);
  }

  function exportActivities() {
    if (apiEnabled) { void apiDownload('/api/exports/activities.csv', 'bd-crm-activities.csv').then(() => notify('Activity export downloaded.')).catch(error => notify(error instanceof Error ? error.message : 'Export could not be downloaded.', 'error')); return; }
    if (downloadCsv('bd-crm-activities.csv', visibleActivities.map(item => ({ Date: item.date, Contacts: item.contactIds.map(id => contacts.find(contact => contact.id === id)?.fullName).filter(Boolean).join(', '), Type: item.type, Outcome: item.outcome, Level: item.meetingLevel, Summary: item.summary, NextAction: item.nextAction, LoggedBy: item.loggedBy })))) notify(`Exported ${visibleActivities.length} activities.`);
  }
  return <div><PageTitle title="Activities" sub="Log conversations, meeting levels, outcomes, and the next action." action={<button className="btn-ghost" onClick={exportActivities}>Export CSV</button>} />
    <div className="mb-3 flex flex-wrap gap-2"><input className="input max-w-sm" placeholder="Search activities..." value={search} onChange={event => setSearch(event.target.value)} /><FancySelect className="input max-w-56" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="">All interaction types</option>{activityTypes.map(type => <option key={type}>{type}</option>)}</FancySelect><span className="self-center text-xs text-muted">{visibleActivities.length} {visibleActivities.length === 1 ? 'record' : 'records'} shown</span></div>
    <div className="grid gap-4 lg:grid-cols-5"><div className="card overflow-x-auto lg:col-span-3"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted"><th className="p-3">Date</th><th className="p-3">Contact</th><th className="p-3">Type</th><th className="p-3">Outcome</th><th className="p-3">Level</th><th className="p-3">Summary</th><th className="p-3">Logged by</th>{!apiEnabled && canEdit && <th className="p-3">Actions</th>}</tr></thead><tbody>{visibleActivities.map(activity => <tr key={activity.id} className="border-b"><td className="p-3">{activity.date}</td><td className="p-3">{activity.contactIds.map(id => contacts.find(contact => contact.id === id)?.fullName).filter(Boolean).join(', ')}</td><td className="p-3">{activity.type}</td><td className="p-3">{activity.outcome}</td><td className="p-3">{activity.meetingLevel || '—'}</td><td className="p-3">{activity.summary}</td><td className="p-3">{activity.loggedBy}</td>{!apiEnabled && canEdit && <td className="p-3"><div className="flex gap-1"><button type="button" className="btn-ghost !p-2" aria-label={`Edit ${activity.type}`} title="Edit activity" onClick={() => editActivity(activity)}><Pencil size={14}/></button><button type="button" className="btn-ghost !p-2" aria-label={`Delete ${activity.type}`} title="Delete activity" onClick={() => deleteActivity(activity)}><Trash2 size={14}/></button></div></td>}</tr>)}</tbody></table></div>
      {canEdit && <form className="card space-y-3 p-5 lg:col-span-2" onSubmit={save}><h2 className="font-semibold">{editingId ? 'Edit interaction' : 'Log an interaction'}</h2>
        <FancySelect className="input" required value={form.contactId} onChange={event => setForm(current => ({ ...current, contactId: event.target.value }))}>{permittedContacts.map(contact => <option key={contact.id} value={contact.id}>{contact.fullName}</option>)}</FancySelect>
        <input className="input" type="date" required value={form.date} onChange={event => setForm(current => ({ ...current, date: event.target.value }))} />
        <FancySelect className="input" value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value, meetingLevel: '', attendees: '' }))}>{activityTypes.map(type => <option key={type}>{type}</option>)}</FancySelect>
        <FancySelect className="input" value={form.outcome} onChange={event => setForm(current => ({ ...current, outcome: event.target.value }))}>{activityOutcomes.map(outcome => <option key={outcome}>{outcome}</option>)}</FancySelect>
        {form.type.startsWith('Meeting') && <><FancySelect className="input" required={formal} value={form.meetingLevel} onChange={event => setForm(current => ({ ...current, meetingLevel: event.target.value }))}><option value="">Meeting level...</option><option>L1</option><option>L2</option><option>L3</option></FancySelect><input className="input" required={formal} placeholder="Attendees" value={form.attendees} onChange={event => setForm(current => ({ ...current, attendees: event.target.value }))} /></>}
        <textarea className="input" required maxLength={250} placeholder="Discussion summary (max 250 characters)" value={form.summary} onChange={event => setForm(current => ({ ...current, summary: event.target.value }))} />
        <input className="input" placeholder="Next action" value={form.nextAction} onChange={event => setForm(current => ({ ...current, nextAction: event.target.value }))} />
        <label className="block text-sm text-muted">Next action due<input className="input mt-1" type="date" value={form.nextActionDue} onChange={event => setForm(current => ({ ...current, nextActionDue: event.target.value }))} /></label>
        <button className="btn w-full justify-center">{editingId ? 'Save changes' : 'Save Activity'}</button>{editingId && <button type="button" className="btn-ghost w-full justify-center" onClick={() => { setEditingId(''); setForm(current => ({ ...current, summary: '', attendees: '', nextAction: '' })); }}>Cancel edit</button>}</form>}
    </div><p className="mt-3 text-xs text-muted">{apiEnabled ? 'Changes are saved to the shared CRM workspace.' : 'Demo changes are saved in this browser.'}</p><div className="sr-only" aria-live="polite">{tasks.length} follow-up tasks</div>
    {deleteTarget && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDeleteTarget(null); }}><section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-activity-title"><div className="modal-heading"><div><div className="import-eyebrow">ACTIVITY HISTORY</div><h2 id="delete-activity-title">Delete this activity?</h2></div><button className="icon-button" aria-label="Close" onClick={() => setDeleteTarget(null)}>×</button></div><p className="text-sm text-muted">“{deleteTarget.summary || deleteTarget.type}” will be removed from this browser’s demo data. This can’t be undone.</p><div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button><button className="btn btn-danger" onClick={confirmDeleteActivity}><Trash2 size={15}/> Delete activity</button></div></section></div>}
  </div>;
}
