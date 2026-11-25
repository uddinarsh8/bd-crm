export type Role='Administrator'|'BD Lead'|'User'|'Leader';
export interface DemoUserRecord{id:string;email:string;name:string;role:Role;isActive:boolean}
export type RelationshipStatus='Hot'|'Warm'|'Slightly Warm'|'Cold'|'Parked';
export type Stage='Mapped'|'Contacted'|'Connected'|'L1'|'L2'|'L3'|'Requirement';
export interface Account{id:string;name:string;status:string;description?:string;createdAt:string}
export interface Contact{id:string;stakeholderId:string;account:string;fullName:string;designation:string;vertical:string;reportsTo?:string;orgLevel:string;location:string;email:string;phone:string;relationshipStatus:RelationshipStatus;bdOwner:string;routeViaVendor:boolean;lastContact:string;lastDiscussionTopic:string;nextAction:string;nextFollowUp:string;highestStage:Stage;expectedAnnualValue?:number;annualTarget?:number;createdAt:string;updatedAt:string}
export interface Activity{id:string;date:string;contactIds:string[];type:string;outcome?:string;meetingLevel?:string;attendees?:string;summary:string;nextAction?:string;nextActionDue?:string;nextActionOwner?:string;loggedBy:string}
export interface TaskItem{id:string;contactId:string;title:string;owner:string;dueDate:string;status:'Pending'|'Completed'|'Overdue';priority?:string}
export type EngagementType='Contract'|'Permanent hire'|'Project/RPO';
export type PositionStatus='Open'|'Profiles Shared'|'Interviewing'|'Offered'|'Joined'|'Dropped'|'Cancelled';
export interface PositionRecord{id:string;candidateName:string;status:PositionStatus;joiningDate:string;actualRateOrFee:number;actualMarginPercent:number}
export interface Requirement{id:string;reqCode:string;raisedBy:string;raisedByContactId?:string;sourceMeeting:string;roleTitle:string;keySkills:string;positions:number;experienceRange:string;workLocation:string;dateReceived:string;status:string;bdOwner:string;account:string;engagementType?:EngagementType;monthlyBillRate?:number;durationMonths?:number;feePerHire?:number;projectValue?:number;expectedMarginPercent?:number;actualMarginPercent?:number;positionsData?:PositionRecord[];summary?:string}
export interface AuditEntry{id:string;user:string;action:string;entityType:string;recordId:string;previousValue?:string;newValue?:string;timestamp:string}
export const RELATIONSHIP_STATUSES:RelationshipStatus[]=['Hot','Warm','Slightly Warm','Cold','Parked'];
export const STAGES:Stage[]=['Mapped','Contacted','Connected','L1','L2','L3','Requirement'];
export const INTERACTION_TYPES=['Call','Email','LinkedIn','WhatsApp','Meeting (formal)','Meeting (informal)','Event'];
export const OUTCOMES=['Connected','No Answer','Call Back Later','Route via Vendor Management','Not Interested'];
export const MEETING_LEVELS=['L1','L2','L3'];
export const LOCATIONS=['Bangalore','Chennai','Coimbatore','Delhi','Gurgaon','Hyderabad','Mumbai','Noida','Pune','US','Japan','Romania','Other'];
export const REQ_STATUSES=['New','Profiles Shared','Interviews','Offer Made','Partially Filled','Closed Won','Closed Lost','On Hold'];
export const DEMO_USERS=[{email:'admin@bdcrm.demo',name:'Asha Verma',role:'Administrator' as Role},{email:'lead@bdcrm.demo',name:'Rohan Mehta',role:'BD Lead' as Role},{email:'user@bdcrm.demo',name:'Priya Nair',role:'User' as Role},{email:'leader@bdcrm.demo',name:'Vikram Rao',role:'Leader' as Role}];
