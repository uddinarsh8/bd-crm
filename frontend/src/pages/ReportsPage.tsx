import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity as ActivityIcon, AlertCircle, ArrowRight, BriefcaseBusiness, Building2, GitBranch, Network, ShieldCheck, UserRound } from 'lucide-react';
import { PageTitle } from '../components/ui';
import { useApp } from '../store/AppContext';
import { REQ_STATUSES, STAGES } from '../types';
import { downloadCsv } from '../utils/csv';
import { apiDownload, apiEnabled, apiRequest } from '../utils/api';

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
const activitySeries = [
  { key: 'Calls', label: 'Calls', color: '#0f1b3d' },
  { key: 'Emails', label: 'Emails', color: '#77819a' },
  { key: 'Meetings', label: 'Meetings', color: '#b0b6c4' },
  { key: 'Other', label: 'Other', color: '#ff3d8b' },
] as const;

function CountBarList({ rows, color = '#0f1b3d' }: { rows: Array<{ label: string; value: number }>; color?: string }) {
  const maximum = Math.max(1, ...rows.map(row => Number(row.value) || 0));
  return <div className="count-bar-list" role="list">
    {rows.map(row => {
      const value = Math.max(0, Number(row.value) || 0);
      const width = value ? Math.max(2, value / maximum * 100) : 0;
      return <div className="count-bar-row" role="listitem" key={row.label}>
        <span className="count-bar-label" title={row.label}>{row.label}</span>
        <span className="count-bar-track"><span className="count-bar-fill" style={{ width: `${width}%`, backgroundColor: color }} /></span>
        <b className="count-bar-value">{value}</b>
      </div>;
    })}
  </div>;
}

function ActivityByPersonChart({ rows }: { rows: Array<{ person: string; Calls: number; Emails: number; Meetings: number; Other: number }> }) {
  const maxTotal = Math.max(1, ...rows.map(row => activitySeries.reduce((sum, series) => sum + (Number(row[series.key]) || 0), 0)));
  return <div className="activity-person-chart">
    <div className="activity-chart-legend">{activitySeries.map(series => <span key={series.key}><i style={{ backgroundColor: series.color }} />{series.label}</span>)}</div>
    {rows.map(row => {
      const total = activitySeries.reduce((sum, series) => sum + (Number(row[series.key]) || 0), 0);
      return <div className="activity-person-row" key={row.person}>
        <span className="count-bar-label" title={row.person}>{row.person}</span>
        <span className="count-bar-track activity-stack">{activitySeries.map(series => {
          const value = Math.max(0, Number(row[series.key]) || 0);
          return value ? <span className="activity-stack-segment" key={series.key} style={{ width: `${value / maxTotal * 100}%`, backgroundColor: series.color }} title={`${series.label}: ${value}`} /> : null;
        })}</span>
        <b className="count-bar-value">{total}</b>
      </div>;
    })}
  </div>;
}

interface ApiReport {
  generatedAt: string;
  weekStart: string;
  today: string;
  latestRecordAt: string | null;
  summary: { mappedContacts: number; meetingsHeld: number; openRequirements: number; openPositions: number; overdueFollowUps: number };
  relationshipDistribution: Array<{ status: string; count: number }>;
  dataQuality: { contactsReviewed: number; contactsWithGaps: number; completenessPercent: number; records: Array<{ id: string; fullName: string; missing: string[] }> } | null;
  pipeline: Array<{ stage: string; count: number; contacts: Array<{ id: string; fullName: string }> }>;
  activityByPerson: Array<{ person: string; calls: number; emails: number; meetings: number; other?: number }>;
  weekActivities: Array<{ id: string; contactId: string; date: string; loggedBy: string; type: string; outcome: string | null }>;
  overdueTasks: Array<{ id: string; contactId: string; contact: string; title: string; owner: string; dueDate: string }>;
  requirementsByStatus: Array<{ status: string; count: number }>;
  openRequirementsList: Array<{ id: string; roleTitle: string; positions: number; status: string }>;
  quietContacts: Array<{ id: string; fullName: string; designation: string | null; owner: string; lastActivityAt: string | null }>;
  hierarchy: Array<{ id: string; fullName: string; designation: string | null; relationshipRating: string; reportsToId: string | null; reportsTo: string | null }>;
}

export default function ReportsPage() {
  const { contacts, activities, tasks, requirements, role, userName, addAudit } = useApp();
  const [apiReport, setApiReport] = useState<ApiReport | null>(null);
  const [reportError, setReportError] = useState('');
  const [activityDays, setActivityDays] = useState<7 | 30>(30);
  useEffect(() => {
    if (!apiEnabled) return;
    let active = true;
    const load = () => void apiRequest<ApiReport>('/api/reports/dashboard').then(report => { if (active) { setApiReport(report); setReportError(''); } }).catch(error => { if (active) setReportError(error instanceof Error ? error.message : 'Server report could not be loaded.'); });
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const today = apiReport?.today || dayKey(new Date());
  const quietCutoff = dayKey(new Date(Date.now() - 30 * 86400000));
  const weekStartDate = new Date(); weekStartDate.setDate(weekStartDate.getDate() - 6);
  const weekStart = apiReport?.weekStart || dayKey(weekStartDate);
  const visibleContacts = role === 'User' ? contacts.filter(contact => contact.bdOwner === userName) : contacts;
  const permittedIds = new Set(visibleContacts.map(contact => contact.id));
  const visibleActivities = activities.filter(activity => activity.contactIds.some(id => permittedIds.has(id)));
  const visibleTasks = role === 'User' ? tasks.filter(task => task.owner === userName) : tasks;
  const visibleRequirements = requirements.filter(requirement => role !== 'User' || requirement.bdOwner === userName);
  const openRequirements = visibleRequirements.filter(requirement => !['Closed Won', 'Closed Lost'].includes(requirement.status));
  const overdue = visibleTasks.filter(task => task.status !== 'Completed' && task.dueDate < today);
  const quiet = visibleContacts.filter(contact => !contact.lastContact || contact.lastContact < quietCutoff);
  const pipeline = apiReport?.pipeline || STAGES.map(stage => ({ stage, count: visibleContacts.filter(contact => contact.highestStage === stage).length, contacts: visibleContacts.filter(contact => contact.highestStage === stage).map(contact => ({ id: contact.id, fullName: contact.fullName })) }));
  const thisWeek = apiReport ? apiReport.weekActivities.map(activity => ({ ...activity, contactIds: [activity.contactId] })).filter(activity => activity.date <= today) : visibleActivities.filter(activity => activity.date >= weekStart && activity.date <= today);
  const activityRangeDate = new Date(`${today}T00:00:00`); activityRangeDate.setDate(activityRangeDate.getDate() - activityDays + 1);
  const activityRangeStart = dayKey(activityRangeDate);
  const activityRange = activityDays === 7 && apiReport ? thisWeek : visibleActivities.filter(activity => activity.date >= activityRangeStart && activity.date <= today);
  const activityPeople = [...new Set(activityRange.map(activity => activity.loggedBy))];
  const activityChart = activityPeople.map(person => ({ person, Calls: activityRange.filter(activity => activity.loggedBy === person && activity.type === 'Call').length, Emails: activityRange.filter(activity => activity.loggedBy === person && activity.type === 'Email').length, Meetings: activityRange.filter(activity => activity.loggedBy === person && activity.type.startsWith('Meeting')).length, Other: activityRange.filter(activity => activity.loggedBy === person && !['Call', 'Email'].includes(activity.type) && !activity.type.startsWith('Meeting')).length }));
  const requirementChart = apiReport?.requirementsByStatus || REQ_STATUSES.map(status => ({ status, count: visibleRequirements.filter(requirement => requirement.status === status).length }));
  const relationshipDistribution = apiReport?.relationshipDistribution || ['Hot', 'Warm', 'Slightly Warm', 'Cold', 'Parked'].map(status => ({ status, count: visibleContacts.filter(contact => contact.relationshipStatus === status).length }));
  const positions = apiReport?.summary.openPositions ?? openRequirements.reduce((sum, requirement) => sum + requirement.positions, 0);
  const reportOpenRequirements = apiReport?.openRequirementsList || openRequirements.map(item => ({ id: item.id, roleTitle: item.roleTitle, positions: item.positions, status: item.status }));
  const reportOverdue = apiReport?.overdueTasks || overdue.map(task => ({ id: task.id, contactId: task.contactId, contact: contacts.find(contact => contact.id === task.contactId)?.fullName || 'Contact', title: task.title, owner: task.owner, dueDate: task.dueDate }));
  const reportQuiet = apiReport?.quietContacts || quiet.map(contact => ({ id: contact.id, fullName: contact.fullName, designation: contact.designation, owner: contact.bdOwner, lastActivityAt: contact.lastContact || null }));
  const reportHierarchy = apiReport?.hierarchy || visibleContacts.map(contact => ({ id: contact.id, fullName: contact.fullName, designation: contact.designation, relationshipRating: contact.relationshipStatus, reportsToId: null, reportsTo: contact.reportsTo || null }));
  const lastUpdated = useMemo(() => (apiReport?.latestRecordAt?.slice(0, 10) && apiReport.latestRecordAt.slice(0, 10) <= today) ? apiReport.latestRecordAt.slice(0, 10) : (() => { const dates = [...visibleActivities.map(activity => activity.date), ...visibleRequirements.map(requirement => requirement.dateReceived)].filter(date => date <= today).sort(); return dates[dates.length - 1] || 'No activity yet'; })(), [apiReport, visibleActivities, visibleRequirements, today]);

  async function exportReport() {
    if (apiEnabled) { try { await apiDownload('/api/exports/reports/dashboard.csv', 'bd-crm-reports.csv'); } catch (error) { window.alert(error instanceof Error ? error.message : 'Export could not be downloaded.'); } return; }
    const rows: Array<Record<string, string | number>> = [];
    pipeline.forEach(row => rows.push({ Report: 'Pipeline by stage', Record: row.stage, Value: row.count, Details: row.contacts.map(contact => contact.fullName).join('; ') }));
    thisWeek.forEach(activity => rows.push({ Report: 'Activity this week', Record: activity.loggedBy, Value: activity.type, Details: `${activity.date} · ${activity.outcome || ''}` }));
    reportOverdue.forEach(task => rows.push({ Report: 'Overdue follow-ups', Record: task.title, Value: task.dueDate, Details: `${task.contact} / ${task.owner}` }));
    reportOpenRequirements.forEach(item => rows.push({ Report: 'Open requirements', Record: item.roleTitle, Value: item.positions, Details: item.status }));
    reportQuiet.forEach(contact => rows.push({ Report: 'Contacts gone quiet', Record: contact.fullName, Value: contact.lastActivityAt || 'Never contacted', Details: contact.owner }));
    reportHierarchy.forEach(contact => rows.push({ Report: 'Stakeholder hierarchy', Record: contact.fullName, Value: contact.relationshipRating, Details: contact.reportsTo || 'Top of branch' }));
    if (downloadCsv('bd-crm-reports.csv', rows)) addAudit({ action: 'Reports exported', entityType: 'Report', recordId: `${rows.length} rows` });
  }

  return <div className="reports-page"><PageTitle title="Reports & Analytics" sub="Account coverage, activity, open demand, and follow-up health." action={<button className="btn-ghost" onClick={exportReport}>Export reports CSV</button>} />
    {reportError && <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The live report is temporarily unavailable. Showing totals from the records currently loaded for your role. {reportError}</p>}
    <section className="report-overview"><div className="report-overview-heading"><div><div className="import-eyebrow">LEADERSHIP SNAPSHOT</div><h2 className="report-section-title"><Building2 size={15}/>Account overview</h2><p className="mt-1 text-xs text-muted">Latest record date: {lastUpdated}{apiReport && ` · Updated ${new Date(apiReport.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}</p></div><Link className="panel-link" to="/accounts">View accounts <ArrowRight size={14} /></Link></div>
      <div className="report-overview-grid">{[['Mapped contacts', apiReport?.summary.mappedContacts ?? visibleContacts.length, '/contacts'], ['Meetings held', apiReport?.summary.meetingsHeld ?? visibleActivities.filter(activity => activity.type.startsWith('Meeting') && activity.date <= today).length, '/meetings'], ['Open requirements', apiReport?.summary.openRequirements ?? openRequirements.length, '/requirements'], ['Open positions', positions, '/requirements'], ['Overdue follow-ups', apiReport?.summary.overdueFollowUps ?? overdue.length, '/follow-ups']].map(([label, value, to]) => <Link key={String(label)} to={String(to)}><small>{label}</small><b className={label === 'Overdue follow-ups' && Number(value) ? 'report-pink-value' : ''}>{value}</b></Link>)}</div>
      <div className="relationship-distribution"><span>Relationship rating</span>{relationshipDistribution.map(({ status, count }) => <div key={status}><i className={`relationship-dot dot-${status.toLowerCase().replace(' ', '-')}`} /><Link to={`/contacts?status=${encodeURIComponent(status)}`}>{status}</Link><b>{count}</b></div>)}</div>
    </section>

    <div className="reports-grid">
      {(role === 'BD Lead' || role === 'Administrator') && apiReport?.dataQuality && <section className="report-card"><div className="report-card-heading"><div><div className="import-eyebrow">DATA QUALITY</div><h2 className="report-section-title"><ShieldCheck size={15}/>Contact record completeness</h2></div><span className="report-count">{apiReport.dataQuality.completenessPercent}% complete</span></div><p className="text-sm text-muted">{apiReport.dataQuality.contactsWithGaps} of {apiReport.dataQuality.contactsReviewed} contacts are missing at least one key field.</p>{apiReport.dataQuality.records.length ? <div className="report-row-list mt-3">{apiReport.dataQuality.records.slice(0, 8).map(record => <Link to={`/contacts/${record.id}`} className="report-data-row" key={record.id}><span className="report-status-dot" /><span><b>{record.fullName}</b><small>Missing: {record.missing.join(', ')}</small></span><ArrowRight size={14} /></Link>)}</div> : <div className="report-empty mt-3">All reviewed contacts have the key fields.</div>}</section>}
      <section className="report-card"><div className="report-card-heading"><div><div className="import-eyebrow">REPORT 02</div><h2 className="report-section-title"><GitBranch size={15}/>Pipeline by stage</h2></div><Link to="/pipeline" className="panel-link">Open pipeline <ArrowRight size={13} /></Link></div><CountBarList rows={pipeline.map(row => ({ label: row.stage, value: row.count }))} /><div className="mt-2 flex flex-wrap gap-2">{pipeline.map(row => <details key={row.stage} className="text-xs"><summary className="cursor-pointer">{row.stage} · {row.count}</summary><div className="mt-1 space-y-1">{row.contacts.map(contact => <Link className="block text-primary" key={contact.id} to={`/contacts/${contact.id}`}>{contact.fullName}</Link>)}</div></details>)}</div></section>

      <section className="report-card"><div className="report-card-heading"><div><div className="import-eyebrow">REPORT 03</div><h2 className="report-section-title"><ActivityIcon size={15}/>Activity by person · last {activityDays} days</h2></div><div className="flex items-center gap-2"><div className="activity-range-switch" aria-label="Activity chart date range"><button type="button" aria-pressed={activityDays === 7} onClick={() => setActivityDays(7)}>7 days</button><button type="button" aria-pressed={activityDays === 30} onClick={() => setActivityDays(30)}>30 days</button></div><span className="report-range">{activityRangeStart} – {today}</span></div></div>{activityChart.length ? <ActivityByPersonChart rows={activityChart} /> : <div className="report-empty">No team activity recorded in this period.</div>}<div className="mt-2 space-y-1 text-xs">{activityRange.map(activity => <Link className="block text-primary" key={activity.id} to={`/contacts/${activity.contactIds[0]}`}>{activity.date} · {activity.loggedBy} · {activity.type} · {activity.outcome}</Link>)}</div></section>

      <section className="report-card"><div className="report-card-heading"><div><div className="import-eyebrow">REPORT 04</div><h2 className="report-section-title"><AlertCircle size={15}/>Overdue follow-ups</h2></div><span className="report-count">{apiReport?.summary.overdueFollowUps ?? overdue.length} open</span></div>{reportOverdue.length ? <div className="report-row-list">{reportOverdue.map(task => <Link to={task.contactId ? `/contacts/${task.contactId}` : '/follow-ups'} className="report-data-row" key={task.id}><span className="report-status-dot" /><span><b>{task.title}</b><small>{task.contact} / {task.owner}</small></span><time>{task.dueDate}</time></Link>)}</div> : <div className="report-empty">No overdue tasks.</div>}</section>

      <section className="report-card"><div className="report-card-heading"><div><div className="import-eyebrow">REPORT 05</div><h2 className="report-section-title"><BriefcaseBusiness size={15}/>Open requirements</h2></div><span className="report-count">{apiReport?.summary.openRequirements ?? openRequirements.length} {openRequirements.length === 1 ? 'record' : 'records'}</span></div><CountBarList rows={requirementChart.map(row => ({ label: row.status, value: row.count }))} /><div className="report-requirement-list">{reportOpenRequirements.map(requirement => <Link to="/requirements" key={requirement.id}><b>{requirement.roleTitle}</b><span>{requirement.positions} positions / {requirement.status}</span></Link>)}</div></section>

      <section className="report-card"><div className="report-card-heading"><div><div className="import-eyebrow">REPORT 06</div><h2 className="report-section-title"><UserRound size={15}/>Contacts gone quiet</h2></div><span className="report-count">30+ days</span></div>{reportQuiet.length ? <div className="report-row-list">{reportQuiet.map(contact => <Link to={`/contacts/${contact.id}`} className="report-data-row" key={contact.id}><span className="quiet-avatar">{contact.fullName.split(' ').map(part => part[0]).join('')}</span><span><b>{contact.fullName}</b><small>{contact.designation} / {contact.owner}</small></span><time>{contact.lastActivityAt || 'Never contacted'}</time></Link>)}</div> : <div className="report-empty">All visible stakeholders have recent activity.</div>}</section>

      <section className="report-card"><div className="report-card-heading"><div><div className="import-eyebrow">STAKEHOLDER COVERAGE</div><h2 className="report-section-title"><Network size={15}/>Reporting hierarchy</h2></div><Link to="/contacts" className="panel-link">All contacts <ArrowRight size={13} /></Link></div><div className="org-report-list">{reportHierarchy.map(contact => <Link to={`/contacts/${contact.id}`} className={`org-report-row ${contact.reportsTo ? 'is-child' : ''}`} key={contact.id}><span className="org-branch">{contact.reportsTo ? '↳' : '•'}</span><span className="org-report-person"><b>{contact.fullName}</b><small>{contact.designation}</small></span><span className="org-report-status">{contact.relationshipRating}</span><small className="org-reports-to">{contact.reportsTo ? `Reports to ${contact.reportsTo}` : 'Top of branch'}</small></Link>)}</div></section>
    </div>
    <p className="mt-3 text-xs text-muted">Figures reflect the records available to your role. Connected CRM report totals and chart data are calculated by the server and refresh automatically.</p>
  </div>;
}
