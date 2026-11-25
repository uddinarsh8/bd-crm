import { FancySelect } from '../components/FancySelect';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Download, Plus, UsersRound, BriefcaseBusiness, CircleDollarSign } from 'lucide-react';
import { PageTitle } from '../components/ui';
import { useApp } from '../store/AppContext';
import { apiDownload, apiEnabled, apiRequest } from '../utils/api';
import { currentFinancialYearRequirements, rate, scorecard } from '../utils/scorecards';
import { downloadCsv } from '../utils/csv';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
const valueOf = (requirement: { engagementType?: string; positions: number; monthlyBillRate?: number; durationMonths?: number; feePerHire?: number; projectValue?: number }) => requirement.engagementType === 'Permanent hire' ? requirement.positions * (requirement.feePerHire || 0) : requirement.engagementType === 'Project/RPO' ? requirement.projectValue || 0 : requirement.positions * (requirement.monthlyBillRate || 0) * (requirement.durationMonths || 0);

export default function AccountsPage() {
  const { accounts, setAccounts, contacts, requirements, role, userName, addAudit, refreshFromApi } = useApp();
  const [accountName, setAccountName] = useState('');
  const [accountDescription, setAccountDescription] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editDraft, setEditDraft] = useState({ name: '', description: '', status: 'Active' });
  const [editMessage, setEditMessage] = useState('');
  const canManageAccounts = role === 'Administrator' || role === 'BD Lead';
  const visibleContacts = role === 'User' ? contacts.filter(contact => contact.bdOwner === userName) : contacts;
  const visibleRequirements = role === 'User' ? requirements.filter(requirement => requirement.bdOwner === userName) : requirements;
  const totalPotential = visibleRequirements.reduce((sum, requirement) => sum + valueOf(requirement), 0);
  const openRequirements = visibleRequirements.filter(requirement => !requirement.status.startsWith('Closed')).length;
  const activeAccounts = accounts.filter(account => account.status === 'Active').length;
  async function addAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!accountName.trim() || accounts.some(account => account.name.toLowerCase() === accountName.trim().toLowerCase())) { setAccountMessage('Enter a new account name. This account may already exist.'); return; }
    if (apiEnabled) {
      try { await apiRequest('/api/accounts', { method: 'POST', body: JSON.stringify({ name: accountName.trim(), description: accountDescription.trim(), status: 'Active' }) }); await refreshFromApi(); setAccountName(''); setAccountDescription(''); setAccountMessage('Account added to the shared CRM.'); }
      catch (error) { setAccountMessage(error instanceof Error ? error.message : 'Account could not be saved.'); }
      return;
    }
    const account = { id: `acc-${Date.now()}`, name: accountName.trim(), status: 'Active', description: accountDescription.trim(), createdAt: new Date().toISOString().slice(0, 10) };
    setAccounts(previous => [account, ...previous]); addAudit({ action: 'Account created', entityType: 'Account', recordId: account.id, newValue: account.name }); setAccountName(''); setAccountDescription(''); setAccountMessage('Account added to this browser’s demo data.');
  }
  function startEdit(account: typeof accounts[number]) {
    setEditingId(account.id);
    setEditDraft({ name: account.name, description: account.description || '', status: account.status });
    setEditMessage('');
  }
  async function saveAccount(event: React.FormEvent) {
    event.preventDefault();
    const account = accounts.find(item => item.id === editingId);
    if (!account) return;
    if (accounts.some(item => item.id !== account.id && item.name.trim().toLowerCase() === editDraft.name.trim().toLowerCase())) { setEditMessage('An account with this name already exists.'); return; }
    if (apiEnabled) {
      try {
        await apiRequest(`/api/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify({ name: editDraft.name.trim(), description: editDraft.description.trim(), status: editDraft.status }) });
        await refreshFromApi(); setEditingId(''); setEditMessage('');
      } catch (error) { setEditMessage(error instanceof Error ? error.message : 'Account changes could not be saved.'); }
      return;
    }
    setAccounts(previous => previous.map(item => item.id === account.id ? { ...item, name: editDraft.name.trim(), description: editDraft.description.trim(), status: editDraft.status } : item));
    addAudit({ action: 'Account updated', entityType: 'Account', recordId: account.id, previousValue: JSON.stringify({ name: account.name, description: account.description, status: account.status }), newValue: JSON.stringify(editDraft) });
    setEditingId(''); setEditMessage('');
  }
  function exportAccounts() {
    if (apiEnabled) { void apiDownload('/api/exports/accounts.csv', 'bd-crm-accounts.csv').catch(error => window.alert(error instanceof Error ? error.message : 'Export could not be downloaded.')); return; }
    downloadCsv('bd-crm-accounts.csv', accounts.map(account => { const rows = requirements.filter(requirement => requirement.account === account.name && (role !== 'User' || requirement.bdOwner === userName)); return { Account: account.name, Status: account.status, Contacts: visibleContacts.filter(contact => contact.account === account.name).length, Requirements: rows.length, Positions: rows.reduce((sum, row) => sum + row.positions, 0), PotentialRevenue: rows.reduce((sum, row) => sum + valueOf(row), 0) }; }));
  }
  return <div className="accounts-page">
    <PageTitle title="Accounts" sub="A clear view of client relationships, stakeholder coverage, and open demand." action={<button className="btn-ghost" onClick={exportAccounts}><Download size={15}/> Export CSV</button>} />
    <section className="account-overview" aria-label="Account portfolio overview">
      <div className="account-overview-heading"><div><span>PORTFOLIO OVERVIEW</span><h2>Your account landscape</h2></div><span className="account-count-pill">{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}</span></div>
      <div className="account-overview-grid">
        <div className="account-overview-metric"><span className="account-overview-icon"><Building2 size={17}/></span><div><small>Active accounts</small><b>{activeAccounts}</b></div></div>
        <div className="account-overview-metric"><span className="account-overview-icon"><UsersRound size={17}/></span><div><small>Stakeholders</small><b>{visibleContacts.length}</b></div></div>
        <div className="account-overview-metric"><span className="account-overview-icon"><BriefcaseBusiness size={17}/></span><div><small>Open requirements</small><b>{openRequirements}</b></div></div>
        <div className="account-overview-metric"><span className="account-overview-icon account-overview-icon-pink"><CircleDollarSign size={17}/></span><div><small>Potential revenue</small><b>{money(totalPotential)}</b></div></div>
      </div>
    </section>
    {canManageAccounts && <form className="account-create-card" onSubmit={addAccount}><div className="account-create-heading"><span className="account-create-icon"><Plus size={17}/></span><div><h2>Add an account</h2><p>Start a client record and build its stakeholder map.</p></div></div><div className="account-create-fields"><input className="input" required placeholder="Account name" value={accountName} onChange={event => setAccountName(event.target.value)} /><input className="input" placeholder="Short description (optional)" value={accountDescription} onChange={event => setAccountDescription(event.target.value)} /><button className="btn"><Plus size={15}/> Add account</button></div>{accountMessage && <p role="status" className="account-form-message">{accountMessage}</p>}</form>}
    <div className="accounts-section-heading"><div><span>CLIENT DIRECTORY</span><h2>Accounts in your portfolio</h2></div><p>{visibleContacts.length} visible stakeholders</p></div>
    {accounts.length === 0 && <div className="account-empty"><Building2 size={23}/><h3>No accounts yet</h3><p>Create your first account to start mapping stakeholder relationships.</p></div>}
    <div className="accounts-grid">{accounts.map(account => {
      const accountContacts = visibleContacts.filter(contact => contact.account === account.name);
      const rows = requirements.filter(requirement => requirement.account === account.name && (role !== 'User' || requirement.bdOwner === userName));
      const currentYearScorecard = scorecard(currentFinancialYearRequirements(rows));
      const allTimeScorecard = scorecard(rows);
      const expectedValue = accountContacts.reduce((sum, contact) => sum + (contact.expectedAnnualValue || 0), 0);
      const annualTarget = accountContacts.reduce((sum, contact) => sum + (contact.annualTarget || 0), 0);
      const requested = rows.reduce((sum, row) => sum + row.positions, 0);
      const joined = rows.reduce((sum, row) => sum + (row.positionsData || []).filter(position => position.status === 'Joined').length, 0);
      const potential = rows.reduce((sum, row) => sum + valueOf(row), 0);
      const realised = rows.reduce((sum, row) => sum + (row.positionsData || []).filter(position => position.status === 'Joined').reduce((subtotal, position) => subtotal + (row.engagementType === 'Project/RPO' ? (row.projectValue || 0) / Math.max(row.positions, 1) : position.actualRateOrFee * (row.engagementType === 'Permanent hire' ? 1 : row.durationMonths || 0)), 0), 0);
      return <section className="card account-record-card" key={account.id}><div className="account-record-heading"><div className="account-record-identity"><span className="account-record-symbol"><Building2 size={18}/></span><div><span className="account-record-kicker">CLIENT ACCOUNT</span><h3>{account.name}</h3><p>{account.description || 'Relationship coverage and active opportunities'}</p></div></div><div className="account-record-actions"><span className={`account-status-pill ${account.status === 'Active' ? 'is-active' : ''}`}><i/>{account.status}</span>{canManageAccounts && <button className="btn-ghost account-edit-button" onClick={() => startEdit(account)}>Edit</button>}</div></div>
        {editingId === account.id && <form className="mt-4 grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-4" onSubmit={saveAccount}><input className="input" required value={editDraft.name} onChange={event => setEditDraft(current => ({ ...current, name: event.target.value }))} aria-label="Account name"/><input className="input sm:col-span-2" value={editDraft.description} onChange={event => setEditDraft(current => ({ ...current, description: event.target.value }))} placeholder="Description"/><FancySelect className="input" value={editDraft.status} onChange={event => setEditDraft(current => ({ ...current, status: event.target.value }))}><option>Active</option><option>Inactive</option></FancySelect><div className="flex gap-2 sm:col-span-4"><button className="btn">Save account</button><button className="btn-ghost" type="button" onClick={() => setEditingId('')}>Cancel</button>{editMessage && <span role="alert" className="self-center text-sm text-rose-700">{editMessage}</span>}</div></form>}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Stakeholders', accountContacts.length], ['Open requirements', rows.filter(row => !row.status.startsWith('Closed')).length], ['Positions requested', requested], ['Potential value', money(potential)], ['Realised revenue', money(realised)], ['Expected annual value', money(expectedValue)], ['Annual target', money(annualTarget)], ['Target gap vs realised this FY', money(annualTarget - currentYearScorecard.realisedBottomLine)]].filter(([label]) => role !== 'User' || !['Annual target', 'Target gap vs realised this FY'].includes(String(label))).map(([label, value]) => <div className="rounded-xl bg-slate-50 p-3" key={String(label)}><span className="text-xs text-muted">{label}</span><b className="mt-1 block text-lg">{value}</b></div>)}</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">{[{ period: 'Current financial year', metrics: currentYearScorecard }, { period: 'All time', metrics: allTimeScorecard }].map(({ period, metrics }) => <div className="rounded-xl border p-4" key={period}><h3 className="font-semibold">{period} scorecard</h3><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{[['Requirements generated', metrics.requirementsGenerated], ['Positions joined / requested', `${metrics.positionsJoined} / ${metrics.positionsRequested}`], ['Potential bottom line', money(metrics.potentialBottomLine)], ['Realised revenue', money(metrics.realisedRevenue)], ['Realised bottom line', money(metrics.realisedBottomLine)], ['Fill rate', rate(metrics.fillRate)], ['Requirement conversion', rate(metrics.requirementConversionRate)]].filter(([label]) => role !== 'User' || !String(label).toLowerCase().includes('bottom line')).map(([label, value]) => <div className="rounded-lg bg-slate-50 p-2" key={String(label)}><span className="text-xs text-muted">{label}</span><b className="mt-1 block text-sm">{value}</b></div>)}</div></div>)}</div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-xl border p-4"><h3 className="font-semibold">Fulfilment</h3><p className="mt-2 text-sm text-muted">{joined} of {requested} positions joined · {requested ? Math.round(joined / requested * 100) : 0}% fill rate</p>{role !== 'User' && <p className="text-sm text-muted">Potential bottom line: {money(rows.reduce((sum, row) => sum + valueOf(row) * (row.expectedMarginPercent || 0) / 100, 0))}</p>}</div><div className="rounded-xl border p-4"><h3 className="font-semibold">Stakeholders</h3><div className="mt-2 flex flex-wrap gap-2">{accountContacts.map(contact => <Link className="btn-ghost" key={contact.id} to={`/contacts/${contact.id}`}>{contact.fullName} · {contact.relationshipStatus}</Link>)}</div>{accountContacts.length === 0 && <p className="mt-2 text-sm text-muted">No visible stakeholders in this account.</p>}</div></div>
        <div className="mt-4 border-t pt-4"><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Requirement value</h3><Link className="text-sm text-primary" to="/requirements">Open register</Link></div>{rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted"><th className="py-2">Requirement</th><th className="py-2">Raised by</th><th className="py-2">Stage</th><th className="py-2">Positions joined</th><th className="py-2">Potential</th></tr></thead><tbody>{rows.map(row => <tr className="border-b" key={row.id}><td className="py-2">{row.reqCode} · {row.roleTitle}</td><td className="py-2">{row.raisedBy}</td><td className="py-2">{row.status}</td><td className="py-2">{(row.positionsData || []).filter(position => position.status === 'Joined').length}/{row.positions}</td><td className="py-2">{money(valueOf(row))}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted">No requirements recorded for this account.</p>}</div>
      </section>;
    })}</div>
  </div>;
}
