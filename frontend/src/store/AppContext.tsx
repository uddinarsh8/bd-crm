import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Account, Activity, AuditEntry, Contact, DemoUserRecord, PositionRecord, Requirement, Role, TaskItem } from '../types';
import * as seed from '../data/seed';
import { DEMO_USERS, INTERACTION_TYPES, LOCATIONS, OUTCOMES, RELATIONSHIP_STATUSES, REQ_STATUSES } from '../types';
import { apiEnabled, apiRequest, apiTokenKey } from '../utils/api';

interface Ctx {
  role: Role;
  setRole: (r: Role) => void;
  userName: string;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  accounts: Account[];
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
  users: DemoUserRecord[];
  setUsers: React.Dispatch<React.SetStateAction<DemoUserRecord[]>>;
  contacts: Contact[];
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  activities: Activity[];
  setActivities: React.Dispatch<React.SetStateAction<Activity[]>>;
  tasks: TaskItem[];
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  requirements: Requirement[];
  setRequirements: React.Dispatch<React.SetStateAction<Requirement[]>>;
  auditEntries: AuditEntry[];
  setAuditEntries: React.Dispatch<React.SetStateAction<AuditEntry[]>>;
  addAudit: (entry: Omit<AuditEntry, 'id' | 'user' | 'timestamp'>) => void;
  resetDemo: () => void;
  canEdit: boolean;
  canAdmin: boolean;
  readOnly: boolean;
  apiMode: boolean;
  refreshFromApi: () => Promise<void>;
  lookups: Record<string, string[]>;
  recentContactIds: string[];
  setRecentContactIds: React.Dispatch<React.SetStateAction<string[]>>;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);
const NAMES: Record<Role, string> = { Administrator: 'Asha Verma', 'BD Lead': 'Rohan Mehta', User: 'Priya Nair', Leader: 'Vikram Rao' };
const STORAGE_PREFIX = 'bdcrm-demo-v2:';
const DEFAULT_LOOKUPS: Record<string, string[]> = { Location: LOCATIONS, RelationshipRating: RELATIONSHIP_STATUSES, ActivityType: INTERACTION_TYPES, ActivityOutcome: OUTCOMES, RequirementStatus: REQ_STATUSES };

function useSavedState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    if (apiEnabled) return initialValue;
    try {
      const saved = localStorage.getItem(STORAGE_PREFIX + key);
      return saved ? JSON.parse(saved) as T : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    // API-backed CRM records remain in memory; only the isolated demo mode persists to this browser.
    if (apiEnabled) return;
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* Storage may be unavailable in private browsing. */ }
  }, [key, value]);
  return [value, setValue] as const;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>(() => (sessionStorage.getItem(apiEnabled ? 'bdcrm-api-role' : 'bdcrm-demo-role') as Role | null) || 'User');
  const [notice, setNotice] = useState<{ id: number; message: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const notify = (message: string, tone: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now(); setNotice({ id, message, tone }); window.setTimeout(() => setNotice(current => current?.id === id ? null : current), 3600);
  };
  const [accounts, setAccounts] = useSavedState<Account[]>('accounts', seed.accounts);
  const [users, setUsers] = useSavedState<DemoUserRecord[]>('users', DEMO_USERS.map((user, index) => ({ ...user, id: `usr-${index + 1}`, isActive: true })));
  const [contacts, setContacts] = useSavedState<Contact[]>('contacts', seed.contacts);
  const [activities, setActivities] = useSavedState<Activity[]>('activities', seed.activities);
  const [tasks, setTasks] = useSavedState<TaskItem[]>('tasks', seed.tasks);
  const [requirements, setRequirements] = useSavedState<Requirement[]>('requirements', seed.requirements);
  const [auditEntries, setAuditEntries] = useSavedState<AuditEntry[]>('audit', seed.auditLog);
  const [lookups, setLookups] = useState(DEFAULT_LOOKUPS);
  const [recentContactIds, setRecentContactIds] = useSavedState<string[]>('recentContacts', []);

  const refreshFromApi = async () => {
    if (!apiEnabled || !sessionStorage.getItem(apiTokenKey)) return;
    const [apiAccounts, apiContacts, apiActivities, apiTasks, apiRequirements, apiLookups, apiRecentContacts] = await Promise.all([
      apiRequest<Array<Record<string, unknown>>>('/api/accounts'), apiRequest<Array<Record<string, unknown>>>('/api/contacts'),
      apiRequest<Array<Record<string, unknown>>>('/api/activities'), apiRequest<Array<Record<string, unknown>>>('/api/tasks'),
      apiRequest<Array<Record<string, unknown>>>('/api/requirements'), apiRequest<Record<string, string[]>>('/api/lookups'), apiRequest<Array<{ id: string }>>('/api/contacts/recent'),
    ]);
    setLookups({ ...DEFAULT_LOOKUPS, ...apiLookups });
    setRecentContactIds(apiRecentContacts.map(item => item.id));
    setAccounts(apiAccounts.map(row => ({ id: String(row.id), name: String(row.name), status: String(row.status), description: String(row.description ?? ''), createdAt: '' })));
    setContacts(apiContacts.map(row => ({
      id: String(row.id), stakeholderId: String(row.stakeholderId), account: String(row.account ?? ''), fullName: String(row.fullName),
      designation: String(row.designation ?? ''), vertical: String(row.practice ?? ''), reportsTo: String(row.reportsTo ?? ''), orgLevel: '',
      location: String(row.location ?? ''), email: String(row.email ?? ''), phone: String(row.phone ?? ''),
      relationshipStatus: String(row.relationshipRating ?? 'Cold') as Contact['relationshipStatus'], bdOwner: String(row.owner ?? ''),
      routeViaVendor: Boolean(row.routeViaVendorManagement), lastContact: String(row.lastActivityAt ?? '').slice(0, 10),
      lastDiscussionTopic: String(row.lastDiscussion ?? ''), nextAction: String(row.nextAction ?? ''), nextFollowUp: String(row.nextFollowUpAt ?? '').slice(0, 10),
      highestStage: String(row.engagementStage ?? 'Mapped') as Contact['highestStage'], expectedAnnualValue: Number(row.expectedAnnualValue ?? 0),
      annualTarget: Number(row.annualTarget ?? 0), createdAt: '', updatedAt: '',
    })));
    setActivities(apiActivities.map(row => ({ id: String(row.id), date: String(row.occurredAt).slice(0, 10), contactIds: Array.isArray(row.contactIds) ? row.contactIds.map(String) : [String(row.contactId)], type: String(row.type), outcome: String(row.outcome ?? ''), meetingLevel: String(row.meetingLevel ?? ''), attendees: String(row.attendees ?? ''), summary: String(row.summary), nextAction: String(row.nextAction ?? ''), nextActionDue: String(row.nextActionDueAt ?? '').slice(0, 10), loggedBy: String(row.loggedBy ?? 'CRM user') })));
    setTasks(apiTasks.map(row => ({ id: String(row.id), contactId: String(row.contactId), title: String(row.title), owner: String(row.owner), dueDate: String(row.dueAt).slice(0, 10), status: String(row.status) as TaskItem['status'] })));
    setRequirements(apiRequirements.map(row => ({
      id: String(row.id), reqCode: String(row.requirementCode), raisedBy: String(row.contact ?? ''), raisedByContactId: String(row.contactId),
      sourceMeeting: String(row.sourceMeetingId), roleTitle: String(row.roleTitle), keySkills: String(row.skills ?? ''), positions: Number(row.positionsRequested),
      experienceRange: String(row.experienceRange ?? ''), workLocation: String(row.workLocation ?? ''), dateReceived: String(row.dateReceived ?? '').slice(0, 10), status: String(row.status),
      bdOwner: String(row.bdOwner ?? ''), account: String(row.account ?? ''), engagementType: String(row.engagementType) as Requirement['engagementType'], monthlyBillRate: Number(row.monthlyBillRate ?? 0),
      durationMonths: Number(row.contractMonths ?? 0), feePerHire: Number(row.feePerHire ?? 0), projectValue: Number(row.projectValue ?? 0), expectedMarginPercent: Number(row.expectedMarginPercent ?? 0),
      positionsData: ((row.positions as Array<Record<string, unknown>>) ?? []).map(position => ({ id: String(position.id), candidateName: String(position.candidateName ?? ''), status: String(position.status).replace('ProfilesShared', 'Profiles Shared') as PositionRecord['status'], joiningDate: String(position.joiningDate ?? ''), actualRateOrFee: Number(position.actualBillRateOrFee ?? 0), actualMarginPercent: Number(position.actualMarginPercent ?? 0) })), summary: String(row.summary ?? ''),
    })));
    if (role === 'Administrator' || role === 'BD Lead') {
      const owners = await apiRequest<Array<Record<string, unknown>>>('/api/contacts/owners');
      setUsers(owners.map(owner => ({ id: String(owner.id), email: String(owner.email), name: String(owner.fullName), role: (owner.role === 'BDLead' ? 'BD Lead' : String(owner.role)) as Role, isActive: Boolean(owner.isActive) })));
    }
  };

  useEffect(() => {
    if (!apiEnabled || !sessionStorage.getItem(apiTokenKey)) return;
    void refreshFromApi().catch(() => undefined);
    const timer = window.setInterval(() => void refreshFromApi().catch(() => undefined), 30000);
    return () => window.clearInterval(timer);
  }, [role]);

  const addAudit = (entry: Omit<AuditEntry, 'id' | 'user' | 'timestamp'>) => setAuditEntries(previous => [{
    ...entry,
    id: `au-${Date.now()}`,
    user: apiEnabled ? sessionStorage.getItem('bdcrm-api-name') || NAMES[role] : sessionStorage.getItem('bdcrm-demo-name') || NAMES[role],
    timestamp: new Date().toISOString(),
  }, ...previous]);

  const resetDemo = () => {
    setContacts(seed.contacts);
    setAccounts(seed.accounts);
    setUsers(DEMO_USERS.map((user, index) => ({ ...user, id: `usr-${index + 1}`, isActive: true })));
    setActivities(seed.activities);
    setTasks(seed.tasks);
    setRequirements(seed.requirements);
    setAuditEntries(seed.auditLog);
  };

  const value = useMemo<Ctx>(() => ({
    role, setRole, userName: apiEnabled ? sessionStorage.getItem('bdcrm-api-name') || NAMES[role] : sessionStorage.getItem('bdcrm-demo-name') || NAMES[role], notify, accounts, setAccounts, users, setUsers,
    contacts, setContacts, activities, setActivities, tasks, setTasks,
    requirements, setRequirements, auditEntries, setAuditEntries, addAudit, resetDemo,
    canEdit: role !== 'Leader', canAdmin: role === 'Administrator', readOnly: role === 'Leader', apiMode: apiEnabled, refreshFromApi, lookups, recentContactIds, setRecentContactIds,
  }), [role, accounts, users, contacts, activities, tasks, requirements, auditEntries, lookups, recentContactIds]);

  return <AppCtx.Provider value={value}>{children}{notice && <div className={`app-toast toast-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.message}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}</AppCtx.Provider>;
}
