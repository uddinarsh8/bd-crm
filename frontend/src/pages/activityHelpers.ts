import {INTERACTION_TYPES,OUTCOMES} from '../types';
export {INTERACTION_TYPES,OUTCOMES};
const ORDER=['Mapped','Contacted','Connected','L1','L2','L3','Requirement'];
export function deriveStageFn(current:string,type:string,level?:string){let n=ORDER.indexOf(current); if(level) n=Math.max(n,ORDER.indexOf(level)); else if(type) n=Math.max(n,ORDER.indexOf('Contacted')); return ORDER[n];}
