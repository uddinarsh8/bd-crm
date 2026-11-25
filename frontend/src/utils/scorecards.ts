import type { Requirement } from '../types';

export interface ScorecardMetrics {
  requirementsGenerated: number;
  positionsRequested: number;
  positionsCancelled: number;
  positionsJoined: number;
  potentialRevenue: number;
  potentialBottomLine: number;
  realisedRevenue: number;
  realisedBottomLine: number;
  fillRate: number;
  requirementConversionRate: number;
}

const amountPerRequirement = (requirement: Requirement) => {
  const type = requirement.engagementType || 'Contract';
  if (type === 'Permanent hire') return requirement.positions * (requirement.feePerHire || 0);
  if (type === 'Project/RPO') return requirement.projectValue || 0;
  return requirement.positions * (requirement.monthlyBillRate || 0) * (requirement.durationMonths || 0);
};

const realized = (requirement: Requirement) => (requirement.positionsData || []).filter(position => position.status === 'Joined').reduce((totals, position) => {
  const type = requirement.engagementType || 'Contract';
  const revenue = type === 'Project/RPO'
    ? (requirement.projectValue || 0) / Math.max(requirement.positions, 1)
    : position.actualRateOrFee * (type === 'Contract' ? requirement.durationMonths || 0 : 1);
  return { revenue: totals.revenue + revenue, bottomLine: totals.bottomLine + revenue * (position.actualMarginPercent || 0) / 100 };
}, { revenue: 0, bottomLine: 0 });

export function scorecard(requirements: Requirement[]): ScorecardMetrics {
  const positionsRequested = requirements.reduce((sum, requirement) => sum + requirement.positions, 0);
  const positionsJoined = requirements.reduce((sum, requirement) => sum + (requirement.positionsData || []).filter(position => position.status === 'Joined').length, 0);
  const positionsCancelled = requirements.reduce((sum, requirement) => sum + (requirement.positionsData || []).filter(position => position.status === 'Cancelled').length, 0);
  const potentialRevenue = requirements.reduce((sum, requirement) => sum + amountPerRequirement(requirement), 0);
  const potentialBottomLine = requirements.reduce((sum, requirement) => sum + amountPerRequirement(requirement) * (requirement.expectedMarginPercent || 0) / 100, 0);
  const realisedTotals = requirements.reduce((sum, requirement) => {
    const value = realized(requirement);
    return { revenue: sum.revenue + value.revenue, bottomLine: sum.bottomLine + value.bottomLine };
  }, { revenue: 0, bottomLine: 0 });
  const eligiblePositions = Math.max(positionsRequested - positionsCancelled, 0);
  const convertedRequirements = requirements.filter(requirement => (requirement.positionsData || []).some(position => position.status === 'Joined')).length;
  return {
    requirementsGenerated: requirements.length,
    positionsRequested,
    positionsCancelled,
    positionsJoined,
    potentialRevenue,
    potentialBottomLine,
    realisedRevenue: realisedTotals.revenue,
    realisedBottomLine: realisedTotals.bottomLine,
    fillRate: eligiblePositions ? positionsJoined / eligiblePositions * 100 : 0,
    requirementConversionRate: requirements.length ? convertedRequirements / requirements.length * 100 : 0,
  };
}

export function currentFinancialYearRequirements(requirements: Requirement[], now = new Date()): Requirement[] {
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const start = `${startYear}-04-01`;
  const end = `${startYear + 1}-04-01`;
  return requirements.filter(requirement => requirement.dateReceived >= start && requirement.dateReceived < end);
}

export const rate = (value: number) => `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`;
