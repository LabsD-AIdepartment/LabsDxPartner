import { beforeEach, expect, it } from 'vitest';
import { bindPitchStorage, pitchStorageKey } from '../../dev/pitch-storage';
import { exportPitchTransfer, importPitchTransfer } from '../../dev/pitch-transfer';
const scope={scenario:'partner-demo',userId:'sample-user',partnerId:'sample-partner',permissionRevision:'g8',payerId:'payer',currency:'THB'};
const key=['synthetic-withdrawal-journey',scope.scenario,scope.userId,scope.partnerId,scope.permissionRevision,scope.payerId,scope.currency].join('::');
const value=JSON.stringify({version:2,scope,scenario:scope.scenario,seq:0,requests:[],cancellations:[],releasedPeriods:[],releaseLog:[],controls:{staleQuote:false,changedBeneficiary:false,unknownOutcome:false,cancelMode:'success'},beneficiaryBump:0,staleBump:0});
const data={version:1,userId:'native-user',partnerId:'native-partner',entries:[{key,value}]};
beforeEach(()=>{sessionStorage.clear();bindPitchStorage(data.userId,data.partnerId);});
it('exports only this native account wallet, leaving credentials and foreign namespaces out',()=>{
  sessionStorage.setItem(pitchStorageKey(key),value);sessionStorage.setItem('auth-token','private');sessionStorage.setItem('pitch:other:partner:'+key,value);
  expect(exportPitchTransfer(sessionStorage,data.userId,data.partnerId)).toEqual(data);
});
it('restores exact bytes for a fresh browser without replacing newer wallet state',()=>{
  importPitchTransfer(sessionStorage,data,data.userId,data.partnerId);expect(sessionStorage.getItem(pitchStorageKey(key))).toBe(value);
  sessionStorage.setItem(pitchStorageKey(key),'newer');importPitchTransfer(sessionStorage,data,data.userId,data.partnerId);expect(sessionStorage.getItem(pitchStorageKey(key))).toBe('newer');
});
it('rejects a foreign native account and arbitrary storage keys before any writes',()=>{
  expect(()=>importPitchTransfer(sessionStorage,data,'other',data.partnerId)).toThrow();
  expect(()=>importPitchTransfer(sessionStorage,{...data,entries:[{key:'auth-token',value}]},data.userId,data.partnerId)).toThrow();expect(sessionStorage.length).toBe(0);
});
it('rejects duplicate keys and malformed wallet payloads before replacing existing state',()=>{
  sessionStorage.setItem(pitchStorageKey(key),'original');
  expect(()=>importPitchTransfer(sessionStorage,{...data,entries:[...data.entries,...data.entries]},data.userId,data.partnerId,true)).toThrow();
  expect(()=>importPitchTransfer(sessionStorage,{...data,entries:[{key,value:'{}'}]},data.userId,data.partnerId,true)).toThrow();expect(sessionStorage.getItem(pitchStorageKey(key))).toBe('original');
});
