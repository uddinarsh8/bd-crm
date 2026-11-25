import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, Clock3, Flame, Plus, UserRound, UsersRound } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { Contact } from '../types';

function Metric({ label, value, note, icon: Icon, tone, to }: { label: string; value: number; note: string; icon: typeof UsersRound; tone: string; to: string }) {
  return <Link to={to} className="metric-card group">
    <div className={`metric-icon ${tone}`}><Icon size={18} strokeWidth={1.9} /></div>
    <div className="metric-copy"><span>{label}</span><b>{value}</b><small>{note}</small></div>
    <ArrowUpRight className="metric-arrow" size={16} />
  </Link>;
}

export default function Dashboard() {
  const { role, userName, contacts, tasks, requirements, activities, recentContactIds } = useApp();
  const visibleContacts = role === 'User' ? contacts.filter(contact => contact.bdOwner === userName) : contacts;
  const visibleTasks = role === 'User' ? tasks.filter(task => task.owner === userName) : tasks;
  const permittedIds = new Set(visibleContacts.map(contact => contact.id));
  const visibleActivities = activities.filter(activity => activity.contactIds.some(id => permittedIds.has(id)));
  const localNow = new Date();
  const todayKey = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
  const hot = visibleContacts.filter(c => c.relationshipStatus === 'Hot').length;
  const warm = visibleContacts.filter(c => c.relationshipStatus === 'Warm').length;
  const overdue = visibleTasks.filter(t => t.status !== 'Completed' && t.dueDate < todayKey).length;
  const visibleRequirements = requirements.filter(requirement => role !== 'User' || requirement.bdOwner === userName);
  const leader = role === 'Leader';
  const firstName = userName.split(' ')[0];
  const dateLabel = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const greeting = localHour < 12 ? 'Good morning' : localHour < 17 ? 'Good afternoon' : 'Good evening';

  return <div className="dashboard-page">
    <div className="dashboard-heading">
      <div><div className="eyebrow">BUSINESS DEVELOPMENT  /  {role.toUpperCase()}</div><h1>{greeting}, {firstName}<span className="greeting-period">.</span></h1><p>Your relationship pipeline, at a glance.</p></div>
      <div className="date-pill"><CalendarDays size={15} />{dateLabel}</div>
    </div>

    <section className="welcome-panel">
      <div className="welcome-copy"><div className="welcome-label"><span /> YOUR BD DESK</div><h2>{leader ? 'The team is building momentum.' : 'Make the next conversation count.'}</h2><p>{leader ? 'A live view of client relationships and team activity.' : 'A thoughtful follow-up today can move a relationship forward.'}</p>
        {!leader && <div className="welcome-actions"><Link className="welcome-primary" to="/contacts"><Plus size={16} /> Add a contact</Link><Link className="welcome-secondary" to="/activities">Log an interaction <ArrowRight size={15} /></Link><Link className="welcome-secondary" to="/import">Import data <ArrowRight size={15} /></Link></div>}
      </div>
      <div className="welcome-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-core"><UsersRound size={29} strokeWidth={1.5}/></div><span className="orbit-node node-one"/><span className="orbit-node node-two"/><span className="orbit-node node-three"/></div>
      <div className="welcome-foot"><span>NTT DATA</span><i /> Relationship workspace</div>
    </section>

    <div className="section-heading"><div><h2>Relationship pulse</h2><p>Current portfolio snapshot</p></div><Link to="/reports" className="text-link">View reports <ArrowRight size={15} /></Link></div>
    <section className="metric-grid">
      {leader ? <>
        <Metric label="Accounts" value={new Set(contacts.map(contact => contact.account)).size} note="Across the portfolio" icon={UsersRound} tone="tone-blue" to="/accounts" />
        <Metric label="Contacts mapped" value={visibleContacts.length} note="Known stakeholders" icon={UserRound} tone="tone-violet" to="/contacts" />
        <Metric label="Open requirements" value={visibleRequirements.filter(r => !r.status.startsWith('Closed')).length} note="Active opportunities" icon={Check} tone="tone-green" to="/requirements" />
        <Metric label="Quiet relationships" value={visibleContacts.filter(c => !c.lastContact || c.lastContact < new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).length} note="30+ days without contact" icon={Clock3} tone="tone-amber" to="/reports" />
      </> : <>
        <Metric label="My contacts" value={visibleContacts.length} note="In your portfolio" icon={UsersRound} tone="tone-blue" to="/contacts" />
        <Metric label="Hot relationships" value={hot} note="Ready for a next step" icon={Flame} tone="tone-rose" to="/contacts" />
        <Metric label="Warm relationships" value={warm} note="Keep the conversation going" icon={UserRound} tone="tone-amber" to="/contacts" />
        <Metric label="Overdue follow-ups" value={overdue} note="Needs your attention" icon={Clock3} tone="tone-violet" to="/follow-ups" />
      </>}
    </section>

    <div className="dashboard-columns">
      {!leader && <section className="panel-card">
        <div className="panel-heading"><div><div className="panel-kicker">KEEP THINGS MOVING</div><h2>Next up</h2></div><Link className="panel-link" to="/follow-ups">All follow-ups <ArrowRight size={14}/></Link></div>
        <div className="followup-list">{visibleTasks.slice(0, 4).map((t, i) => <Link key={t.id} to="/follow-ups" className="followup-row">
          <div className={`followup-marker ${t.status === 'Overdue' ? 'marker-overdue' : ''}`}>{t.status === 'Overdue' ? <Clock3 size={15}/> : <span>{String(i + 1).padStart(2, '0')}</span>}</div>
          <div className="followup-main"><b>{t.title}</b><span>{contacts.find(c => c.id === t.contactId)?.fullName || 'Contact'}  /  {t.owner}</span></div>
          <div className={`followup-date ${t.status === 'Overdue' ? 'date-overdue' : ''}`}>{t.status === 'Overdue' ? 'Overdue' : t.dueDate.slice(5)}</div>
        </Link>)}</div>
        <Link className="panel-bottom-link" to="/follow-ups">Open follow-up board <ArrowRight size={15}/></Link>
      </section>}

      <section className="panel-card activity-panel">
        <div className="panel-heading"><div><div className="panel-kicker">RECENT CONVERSATIONS</div><h2>Activity</h2></div><Link className="panel-link" to="/activities">View all <ArrowRight size={14}/></Link></div>
        <div className="activity-list">{visibleActivities.slice(0, 4).map((a, i) => <div className="activity-row" key={a.id}>
          <div className={`activity-dot activity-dot-${i % 3}`}><span /></div><div className="activity-main"><div><b>{a.type.replace(' (formal)', '').replace(' (informal)', '')}</b>{a.meetingLevel && <span className="level-chip">{a.meetingLevel}</span>}<time>{a.date.slice(5)}</time></div><p>{a.summary}</p><small>{a.loggedBy}</small></div>
        </div>)}</div>
        <Link className="panel-bottom-link" to="/activities">See activity timeline <ArrowRight size={15}/></Link>
      </section>

      <section className="panel-card">
        <div className="panel-heading"><div><div className="panel-kicker">PICK UP WHERE YOU LEFT OFF</div><h2>Recently viewed</h2></div><Link className="panel-link" to="/contacts">All contacts <ArrowRight size={14}/></Link></div>
        <div className="followup-list">{recentContactIds.map(id => contacts.find(contact => contact.id === id)).filter((contact): contact is Contact => Boolean(contact)).slice(0, 5).map((contact, index) => <Link key={contact.id} to={`/contacts/${contact.id}`} className="followup-row"><div className="followup-marker"><span>{String(index + 1).padStart(2, '0')}</span></div><div className="followup-main"><b>{contact.fullName}</b><span>{contact.designation} / {contact.account}</span></div><div className="followup-date">{contact.relationshipStatus}</div></Link>)}{recentContactIds.length === 0 && <p className="p-4 text-sm text-muted">Contacts you open will appear here.</p>}</div>
      </section>
    </div>
  </div>;
}
