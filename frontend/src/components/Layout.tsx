import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, BarChart3, Bell, Building2, CalendarDays, CheckSquare, FileText, GitBranch, HelpCircle, History, LayoutDashboard, LogOut, Menu, Search, Settings2, Upload, Users, X } from 'lucide-react';
import { useApp } from '../store/AppContext';

const GROUPS = [
  { label: 'WORKSPACE', items: [['/', 'Dashboard', LayoutDashboard], ['/accounts', 'Accounts', Building2], ['/contacts', 'Contacts', Users]] },
  { label: 'ACTIVITY', items: [['/activities', 'Activities', Activity], ['/follow-ups', 'Follow-ups', CheckSquare], ['/meetings', 'Meetings', CalendarDays]] },
  { label: 'GROWTH', items: [['/requirements', 'Requirements', FileText], ['/pipeline', 'Pipeline', GitBranch], ['/reports', 'Reports', BarChart3]] },
  { label: 'TOOLS', items: [['/import', 'Data Import', Upload], ['/audit', 'Audit History', History], ['/admin', 'Administration', Settings2]] },
] as const;

const TITLES: Record<string, string> = {
  '/': 'Dashboard', '/accounts': 'Accounts', '/contacts': 'Contacts', '/activities': 'Activities',
  '/follow-ups': 'Follow-ups', '/meetings': 'Meetings', '/requirements': 'Requirements',
  '/pipeline': 'Pipeline', '/reports': 'Reports', '/import': 'Data Import', '/audit': 'Audit History', '/admin': 'Administration',
};

export default function Layout() {
  const { role, userName, canAdmin, tasks, contacts, accounts, requirements, apiMode } = useApp();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<'notifications' | 'help' | null>(null);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const title = pathname.startsWith('/contacts/') ? 'Contact profile' : (TITLES[pathname] || 'BD CRM');
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const todayKey = `${todayParts.find(part => part.type === 'year')?.value}-${todayParts.find(part => part.type === 'month')?.value}-${todayParts.find(part => part.type === 'day')?.value}`;
  const permittedTasks = role === 'User' ? tasks.filter(task => task.owner === userName) : tasks;
  const overdueCount = permittedTasks.filter(task => task.status !== 'Completed' && task.dueDate < todayKey).length;
  function signOut() { if (apiMode) sessionStorage.clear(); else ['bdcrm-demo-session','bdcrm-demo-role','bdcrm-demo-name'].forEach(key => sessionStorage.removeItem(key)); window.location.href = '/login'; }
  const searchTerm = search.trim().toLowerCase();
  const searchContacts = searchTerm ? contacts.filter(contact => (role !== 'User' || contact.bdOwner === userName) && `${contact.fullName} ${contact.account} ${contact.designation} ${contact.vertical}`.toLowerCase().includes(searchTerm)).slice(0, 5) : [];
  const searchAccounts = searchTerm ? accounts.filter(account => account.name.toLowerCase().includes(searchTerm)).slice(0, 3) : [];
  const searchRequirements = searchTerm ? requirements.filter(requirement => (role !== 'User' || requirement.bdOwner === userName) && `${requirement.reqCode} ${requirement.roleTitle} ${requirement.raisedBy}`.toLowerCase().includes(searchTerm)).slice(0, 3) : [];

  return <div className="app-shell min-h-screen">
    <aside className={`sidebar fixed inset-y-0 left-0 z-20 flex flex-col text-slate-200 ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup">
        <div className="brand-mark"><span>bd</span><i /></div>
        <div className="brand-copy"><div>BD<span>CRM</span></div><small>RELATIONSHIP DESK</small></div>
      </div>
      <div className="workspace-chip"><span className="workspace-dot" /> NTT DATA  /  DEMO</div>

      <nav className="sidebar-nav flex-1 overflow-y-auto">
        {GROUPS.map(group => <section className="nav-group" key={group.label}>
          <div className="nav-caption">{group.label}</div>
          {group.items.filter(([path]) => (path !== '/audit' && path !== '/admin') || canAdmin).map(([path, label, Icon]) =>
            <NavLink end={path === '/'} key={path} to={path} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {path === '/follow-ups' && overdueCount > 0 && <span className="nav-count">{overdueCount}</span>}
            </NavLink>)
          }
        </section>)}
      </nav>

      <div className="sidebar-bottom">
        <button className="help-link" onClick={() => setPanel(panel === 'help' ? null : 'help')} aria-expanded={panel === 'help'}><HelpCircle size={16} strokeWidth={1.8} /><span>Help & support</span></button>
        <button className="sidebar-signout" onClick={signOut}><LogOut size={15}/><span>Sign out</span></button>
        <div className="user-card">
          <div className="avatar">{userName.split(' ').map(s => s[0]).slice(0, 2).join('')}</div>
          <div className="user-meta"><b>{userName}</b><span>{role}</span></div>
        </div>
      </div>
    </aside>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

    <main className="main-shell">
      <header className="topbar">
        <button className="mobile-menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={19}/> : <Menu size={19}/>}</button>
        <div className="crumb"><span>BD CRM</span><span className="crumb-slash">/</span><b>{title}</b></div>
        <div className="topbar-tools">
          <div className="search-wrap relative"><Search size={16} /><input aria-label="Search CRM" placeholder="Search people, accounts, requirements" value={search} onChange={event => setSearch(event.target.value)} />{searchTerm && <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">{searchContacts.map(contact => <NavLink key={contact.id} to={`/contacts/${contact.id}`} onClick={() => setSearch('')} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><b>{contact.fullName}</b><small className="block text-slate-500">Contact · {contact.account}</small></NavLink>)}{searchAccounts.map(account => <NavLink key={account.id} to="/accounts" onClick={() => setSearch('')} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><b>{account.name}</b><small className="block text-slate-500">Account</small></NavLink>)}{searchRequirements.map(requirement => <NavLink key={requirement.id} to="/requirements" onClick={() => setSearch('')} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><b>{requirement.reqCode} · {requirement.roleTitle}</b><small className="block text-slate-500">Requirement · {requirement.raisedBy}</small></NavLink>)}{!searchContacts.length&&!searchAccounts.length&&!searchRequirements.length&&<div className="px-3 py-2 text-sm text-slate-500">No matching records</div>}</div>}</div>
          <div className="today-label">{today}</div>
          <div className="relative"><button className="icon-button notification-button" aria-label="Notifications" aria-expanded={panel === 'notifications'} onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')}><Bell size={18} />{overdueCount > 0 && <i />}</button>{panel === 'notifications' && <section className="utility-popover" aria-label="Notifications"><div className="utility-popover-title"><b>Notifications</b><button onClick={() => setPanel(null)} aria-label="Close">×</button></div>{permittedTasks.filter(task => task.status !== 'Completed' && task.dueDate <= todayKey).slice(0, 5).map(task => <NavLink key={task.id} to="/follow-ups" onClick={() => setPanel(null)} className="utility-notification"><span className="notification-dot"/><span><b>{task.dueDate < todayKey ? 'Overdue follow-up' : 'Due today'}</b><small>{task.title}</small></span></NavLink>)}{!permittedTasks.some(task => task.status !== 'Completed' && task.dueDate <= todayKey) && <p className="utility-empty">You’re all caught up. No follow-ups are due.</p>}<NavLink className="utility-footer" to="/follow-ups" onClick={() => setPanel(null)}>View follow-ups <span>→</span></NavLink></section>}</div>
          <div className="topbar-avatar">{userName[0]}</div>
        </div>
      </header>
      <div className="page-content"><Outlet /></div>
    </main>
    {panel === 'help' && <div className="help-popover-wrap" onClick={event => { if (event.target === event.currentTarget) setPanel(null); }}><section className="help-popover" role="dialog" aria-modal="true" aria-label="Help and support"><button className="help-close" onClick={() => setPanel(null)} aria-label="Close help">×</button><div className="help-icon"><HelpCircle size={20}/></div><div className="import-eyebrow">BD CRM GUIDE</div><h2>How can we help?</h2><p>Use the sidebar to move between your accounts, contacts, interactions, follow-ups, and open requirements.</p><ul><li><b>Log a conversation</b><span>Open Activities, choose a contact, and save the interaction.</span></li><li><b>Keep work moving</b><span>Complete a follow-up and optionally add the next action.</span></li><li><b>Demo data</b><span>Your demo changes are saved in this browser only.</span></li></ul><button className="btn" onClick={() => setPanel(null)}>Got it</button></section></div>}
  </div>;
}
