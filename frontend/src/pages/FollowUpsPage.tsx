import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CircleAlert } from 'lucide-react';
import { PageTitle } from '../components/ui';
import { useApp } from '../store/AppContext';
import { apiDownload, apiEnabled, apiRequest } from '../utils/api';
import { downloadCsv } from '../utils/csv';

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const tomorrow = () => { const date = new Date(); date.setDate(date.getDate() + 1); return localDate(date); };

export default function FollowUpsPage() {
  const { tasks, setTasks, contacts, canEdit, userName, role, addAudit, refreshFromApi, notify } = useApp();
  const today = localDate(new Date());
  const [tab, setTab] = useState('Overdue');
  const [completing, setCompleting] = useState<typeof tasks[number] | null>(null);
  const [nextAction, setNextAction] = useState('');
  const [due, setDue] = useState(tomorrow());
  const bucket = (task: typeof tasks[number]) => task.status === 'Completed' ? 'Completed' : task.dueDate < today ? 'Overdue' : task.dueDate === today ? 'Due Today' : 'Upcoming';
  const permittedTasks = role === 'User' ? tasks.filter(task => task.owner === userName) : tasks;
  const tabs = ['Overdue', 'Due Today', 'Upcoming', 'Completed'];
  const counts = useMemo(() => Object.fromEntries(tabs.map(name => [name, permittedTasks.filter(task => bucket(task) === name).length])), [permittedTasks, today]);
  const visible = permittedTasks.filter(task => bucket(task) === tab).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  function startComplete(task: typeof tasks[number]) { setCompleting(task); setNextAction(''); setDue(tomorrow()); }

  async function complete(task: typeof tasks[number]) {
    const contact = contacts.find(item => item.id === task.contactId);
    const action = nextAction.trim();
    if (apiEnabled) {
      try {
        await apiRequest(`/api/tasks/${task.id}/complete`, { method: 'PATCH', body: JSON.stringify({ nextAction: action || null, nextDueAt: action ? `${due}T09:00:00+05:30` : null }) });
        await refreshFromApi();
        addAudit({ action: 'Follow-up completed', entityType: 'Task', recordId: task.id, previousValue: task.status, newValue: action ? `Completed; next: ${action} (${due})` : 'Completed' });
        notify('Follow-up completed.'); setCompleting(null);
      } catch (error) { notify(error instanceof Error ? error.message : 'Follow-up could not be completed.', 'error'); }
      return;
    }
    setTasks(previous => previous.map(item => item.id === task.id ? { ...item, status: 'Completed' } : item));
    if (action) setTasks(previous => [{ id: `t-${Date.now()}`, contactId: task.contactId, title: action, owner: task.owner, dueDate: due, status: 'Pending' }, ...previous]);
    addAudit({ action: 'Follow-up completed', entityType: 'Task', recordId: task.id, previousValue: task.status, newValue: action ? `Completed; next: ${action} (${due})` : 'Completed' });
    notify('Follow-up completed.'); setCompleting(null);
  }

  async function reopen(task: typeof tasks[number]) {
    if (apiEnabled) {
      try { await apiRequest(`/api/tasks/${task.id}/reopen`, { method: 'PATCH' }); await refreshFromApi(); notify('Follow-up reopened.'); setTab(task.dueDate < today ? 'Overdue' : task.dueDate === today ? 'Due Today' : 'Upcoming'); }
      catch (error) { notify(error instanceof Error ? error.message : 'Follow-up could not be reopened.', 'error'); }
      return;
    }
    setTasks(previous => previous.map(item => item.id === task.id ? { ...item, status: 'Pending' } : item));
    addAudit({ action: 'Follow-up reopened', entityType: 'Task', recordId: task.id, previousValue: 'Completed', newValue: 'Pending' });
    notify('Follow-up reopened.'); setTab(bucket(task) === 'Overdue' ? 'Overdue' : 'Upcoming');
  }

  function exportFollowUps() {
    if (apiEnabled) { void apiDownload('/api/exports/follow-ups.csv', 'bd-crm-follow-ups.csv').catch(error => window.alert(error instanceof Error ? error.message : 'Export could not be downloaded.')); return; }
    downloadCsv('bd-crm-follow-ups.csv', permittedTasks.map(task => ({ DueDate: task.dueDate, Contact: contacts.find(contact => contact.id === task.contactId)?.fullName, Task: task.title, Owner: task.owner, Status: task.status })));
  }
  return <div className="followups-page"><PageTitle title="Follow-ups" sub="See overdue, due today, and upcoming actions for your portfolio." action={<div className="flex gap-2"><button className="btn-ghost" onClick={exportFollowUps}>Export CSV</button><Link className="btn-ghost" to="/activities">Log an interaction</Link></div>} />
    <div className="followup-overview">{tabs.map(name => <button key={name} className={`followup-tab ${tab === name ? 'selected' : ''} tab-${name.toLowerCase().replace(' ', '-')}`} onClick={() => setTab(name)}><span>{name}</span><b>{counts[name] || 0}</b></button>)}</div>
    <section className="followup-list-panel"><div className="followup-list-head"><div><div className="import-eyebrow">{tab.toUpperCase()} QUEUE</div><h2>{tab === 'Due Today' ? 'Due today' : tab === 'Upcoming' ? 'Coming up' : tab === 'Completed' ? 'Recently completed' : 'Needs attention'}</h2></div><span>{visible.length} {visible.length === 1 ? 'task' : 'tasks'}</span></div>
      {visible.length ? <div className="followup-page-list">{visible.map(task => { const contact = contacts.find(item => item.id === task.contactId); return <article className="followup-page-row" key={task.id}><div className={`task-state state-${tab.toLowerCase().replace(' ', '-')}`}>{tab === 'Completed' ? <Check size={15} /> : tab === 'Overdue' ? <CircleAlert size={15} /> : task.dueDate.slice(-2)}</div><div className="followup-page-main"><b>{task.title}</b><span>{contact ? <Link to={`/contacts/${contact.id}`}>{contact.fullName}</Link> : 'Contact'} <i /> {contact?.account || 'Account'} <i /> Owner: {task.owner}</span></div><div className="task-due"><small>{tab === 'Due Today' ? 'DUE TODAY' : tab === 'Overdue' ? 'PAST DUE' : tab === 'Completed' ? 'COMPLETED' : 'DUE DATE'}</small><b>{task.dueDate}</b></div>{canEdit && task.status !== 'Completed' && <button className="task-complete" onClick={() => startComplete(task)}>Complete</button>}{canEdit && task.status === 'Completed' && <button className="btn-ghost" onClick={() => void reopen(task)}>Reopen</button>}</article>; })}</div> : <div className="followup-empty"><span className="empty-check"><Check size={17} /></span><div><b>Nothing in this queue</b><p>When a follow-up lands here, it will appear in this list.</p><Link to="/activities">Log a new interaction <ArrowRight size={14} /></Link></div></div>}
    </section><p className="mt-3 text-xs text-muted">{apiEnabled ? 'Tasks are saved in the shared CRM workspace.' : 'Tasks are saved in this browser for the demo.'}</p>
    {completing && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCompleting(null); }}><form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="complete-task-title" onSubmit={event => { event.preventDefault(); void complete(completing); }}><div className="modal-heading"><div><div className="import-eyebrow">CLOSE THE LOOP</div><h2 id="complete-task-title">Complete follow-up</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setCompleting(null)}>×</button></div><p className="text-sm text-muted">{completing.title}</p><label className="block text-sm font-medium">Next action <span className="text-muted">(optional)</span><input className="input mt-2 w-full" value={nextAction} onChange={event => setNextAction(event.target.value)} placeholder="Add a next step, if needed" /></label>{nextAction.trim() && <label className="block text-sm font-medium">Due date<input type="date" className="input mt-2 w-full" min={today} value={due} onChange={event => setDue(event.target.value)} required /></label>}<div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setCompleting(null)}>Cancel</button><button className="btn" type="submit"><Check size={16}/> Complete task</button></div></form></div>}
  </div>;
}
