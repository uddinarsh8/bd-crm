import { FancySelect } from '../components/FancySelect';
import { useEffect, useState } from 'react';
import { PageTitle } from '../components/ui';
import { useApp } from '../store/AppContext';
import { apiEnabled, apiRequest } from '../utils/api';

type ApiUser = { id: string; email: string; fullName: string; role: string; isActive: boolean; mustChangePassword: boolean };
type Dropdown = { id: string; category: string; value: string; sortOrder: number; isActive: boolean };
const roles = ['Administrator', 'BDLead', 'User', 'Leader'];

export default function AdminPage() {
  const { canAdmin, users, contacts, setUsers } = useApp();
  const [apiUsers, setApiUsers] = useState<ApiUser[]>([]); const [dropdowns, setDropdowns] = useState<Dropdown[]>([]);
  const [recipients, setRecipients] = useState(''); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [role, setRole] = useState('User');
  const [category, setCategory] = useState('Location'); const [value, setValue] = useState(''); const [message, setMessage] = useState('');
  const [dropdownEdits, setDropdownEdits] = useState<Record<string, string>>({});
  async function load() {
    if (!apiEnabled) return;
    try {
      const [people, values, recipientData] = await Promise.all([
        apiRequest<ApiUser[]>('/api/admin/users'), apiRequest<Dropdown[]>('/api/admin/dropdowns'), apiRequest<{ emails: string[] }>('/api/admin/notification-recipients'),
      ]);
      setApiUsers(people); setUsers(people.map(user => ({ id: user.id, email: user.email, name: user.fullName, role: (user.role === 'BDLead' ? 'BD Lead' : user.role) as 'Administrator' | 'BD Lead' | 'User' | 'Leader', isActive: user.isActive }))); setDropdowns(values); setRecipients(recipientData.emails.join(', '));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Administration data could not be loaded.'); }
  }
  useEffect(() => { void load(); }, []);
  if (!canAdmin) return <section className="card p-6"><h1 className="text-xl font-semibold">Administrator access required</h1><p className="mt-2 text-muted">Only administrators can manage CRM users and shared settings.</p></section>;

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    try { const created = await apiRequest<{ resetLinkSent: boolean }>('/api/admin/users', { method: 'POST', body: JSON.stringify({ email, fullName: name, role }) }); setMessage(created.resetLinkSent ? 'User created and setup link emailed.' : 'User created, but setup email was not sent. Configure SMTP before the new user signs in.'); setName(''); setEmail(''); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create user.'); }
  }
  async function updateUser(user: ApiUser, patch: Partial<Pick<ApiUser, 'role' | 'isActive'>>) {
    try { await apiRequest(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(patch) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update user.'); }
  }
  async function resetPassword(user: ApiUser) {
    try { const result = await apiRequest<{ message: string }>(`/api/admin/users/${user.id}/reset-password`, { method: 'POST' }); setMessage(result.message); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not send a password setup link.'); }
  }
  async function updateDropdown(item: Dropdown, changes: Partial<Pick<Dropdown, 'value' | 'sortOrder' | 'isActive'>>) {
    try { await apiRequest(`/api/admin/dropdowns/${item.id}`, { method: 'PATCH', body: JSON.stringify({ category: item.category, value: changes.value ?? item.value, sortOrder: changes.sortOrder ?? item.sortOrder, isActive: changes.isActive ?? item.isActive }) }); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update the dropdown value.'); }
  }
  async function moveDropdown(groupItems: Dropdown[], index: number, offset: -1 | 1) {
    const reordered = [...groupItems];
    const target = index + offset;
    if (target < 0 || target >= reordered.length) return;
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      await Promise.all(reordered.map((item, sortOrder) => apiRequest(`/api/admin/dropdowns/${item.id}`, { method: 'PATCH', body: JSON.stringify({ category: item.category, value: item.value, sortOrder, isActive: item.isActive }) })));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not reorder dropdown values.'); }
  }
  async function addDropdown(event: React.FormEvent) {
    event.preventDefault();
    try { await apiRequest('/api/admin/dropdowns', { method: 'POST', body: JSON.stringify({ category, value, sortOrder: dropdowns.filter(item => item.category === category).length }) }); setValue(''); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add this value.'); }
  }
  async function saveRecipients(event: React.FormEvent) {
    event.preventDefault();
    try { await apiRequest('/api/admin/notification-recipients', { method: 'PUT', body: JSON.stringify({ emails: recipients.split(/[;,\n]/).map(item => item.trim()).filter(Boolean) }) }); setMessage('Weekly leadership report recipients saved.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save recipients.'); }
  }

  if (!apiEnabled) {
    const team = Array.from(new Set(contacts.map(contact => contact.bdOwner)));
    return <div className="space-y-4"><PageTitle title="Administration" sub="Demo sample only. Connect the FastAPI service to manage shared users and dropdowns."/><section className="card p-5"><h2 className="font-semibold">Demo personas</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{users.map(user=><div className="rounded-lg border p-3" key={user.email}><b>{user.name}</b><p className="text-sm text-muted">{user.email} · {user.role}</p></div>)}</div><p className="mt-4 text-sm text-muted">{team.length} BD owners are present in the sample data.</p></section></div>;
  }

  return <div className="space-y-4"><PageTitle title="Administration" sub="Manage access, shared dropdown values, and leadership report recipients."/>{message&&<p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    <form onSubmit={createUser} className="card grid gap-3 p-5 md:grid-cols-4"><div className="md:col-span-4"><h2 className="font-semibold">Add a team member</h2><p className="text-xs text-muted">They receive a one-time password setup link that expires in 30 minutes.</p></div><input className="input" required placeholder="Full name" value={name} onChange={event=>setName(event.target.value)}/><input className="input" type="email" required placeholder="Work email" value={email} onChange={event=>setEmail(event.target.value)}/><FancySelect className="input" value={role} onChange={event=>setRole(event.target.value)}>{roles.map(item=><option key={item}>{item}</option>)}</FancySelect><button className="btn">Create user</button></form>
    <section className="card overflow-x-auto p-5"><h2 className="mb-3 font-semibold">Users and role access</h2><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted"><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Role</th><th className="p-2">Access</th><th className="p-2">Actions</th></tr></thead><tbody>{apiUsers.map(user=><tr className="border-b" key={user.id}><td className="p-2">{user.fullName}</td><td className="p-2">{user.email}</td><td className="p-2"><FancySelect className="input" value={user.role} onChange={event=>void updateUser(user,{role:event.target.value})}>{roles.map(item=><option key={item}>{item}</option>)}</FancySelect></td><td className="p-2">{user.isActive?'Active':'Inactive'}</td><td className="p-2"><div className="flex flex-wrap gap-1"><button className="btn-ghost" onClick={()=>void updateUser(user,{isActive:!user.isActive})}>{user.isActive?'Deactivate':'Activate'}</button><button className="btn-ghost" disabled={!user.isActive} onClick={()=>void resetPassword(user)}>Send reset link</button></div></td></tr>)}</tbody></table></section>
    <div className="grid gap-4 lg:grid-cols-2"><section className="card p-5"><h2 className="font-semibold">Shared dropdown library and defaults</h2><p className="mt-1 text-xs text-muted">Set a default margin for each engagement type. Enter a percentage from 0 to 100.</p><form className="mt-3 flex flex-wrap gap-2" onSubmit={addDropdown}><FancySelect className="input" value={category} onChange={event=>setCategory(event.target.value)}>{['Location','Practice','RelationshipRating','ActivityType','ActivityOutcome','RequirementStatus','DefaultMarginPercent:Contract','DefaultMarginPercent:Permanent hire','DefaultMarginPercent:Project/RPO'].map(item=><option key={item}>{item}</option>)}</FancySelect><input className="input min-w-40 flex-1" value={value} onChange={event=>setValue(event.target.value)} placeholder={category.startsWith('DefaultMarginPercent') ? 'e.g. 20' : 'New allowed value'} required/><button className="btn">{category.startsWith('DefaultMarginPercent') ? 'Save default' : 'Add value'}</button></form><div className="mt-4 space-y-4">{[...new Set(dropdowns.map(item=>item.category))].map(group=><div key={group}><b className="text-sm">{group}</b><div className="mt-2 space-y-2">{dropdowns.filter(item=>item.category===group).sort((a,b)=>a.sortOrder-b.sortOrder).map((item,index,groupItems)=><div className="flex flex-wrap items-center gap-2 rounded-lg border p-2" key={item.id}><input className="input min-w-36 flex-1" aria-label={`${group} value`} value={dropdownEdits[item.id] ?? item.value} onChange={event=>setDropdownEdits(current=>({...current,[item.id]:event.target.value}))}/>{!group.startsWith('DefaultMarginPercent') && <><button className="btn-ghost" type="button" disabled={index===0} aria-label="Move up" onClick={()=>void moveDropdown(groupItems,index,-1)}>↑</button><button className="btn-ghost" type="button" disabled={index===groupItems.length-1} aria-label="Move down" onClick={()=>void moveDropdown(groupItems,index,1)}>↓</button></>}<button className="btn-ghost" type="button" onClick={()=>void updateDropdown(item,{value:dropdownEdits[item.id] ?? item.value})}>Save</button>{!group.startsWith('DefaultMarginPercent') && <button className={`btn-ghost ${item.isActive?'':'opacity-50'}`} type="button" onClick={()=>void updateDropdown(item,{isActive:!item.isActive})}>{item.isActive?'Retire':'Restore'}</button>}</div>)}</div></div>)}</div></section>
      <form className="card p-5" onSubmit={saveRecipients}><h2 className="font-semibold">Weekly leadership report</h2><p className="mt-1 text-sm text-muted">Sent on Monday after 9:00 am India time, when SMTP is configured.</p><label className="mt-3 block text-sm">Recipient emails<textarea className="input mt-1 min-h-28" value={recipients} onChange={event=>setRecipients(event.target.value)} placeholder="leader@company.com, director@company.com"/></label><button className="btn mt-3">Save recipients</button></form></div>
  </div>;
}
