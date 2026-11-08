// Cloud Functions entry point (spec 01). Item 1: reception of the form and the daily purge; item 5: method
// publication; method change of 6/11/2026 (spec 04): coleta mínima with qualificar and graduar (triagem),
// then the rest of the collection; phase B: synthesis (sintetizar) and verification (verificar).
import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { receberFicha } from './receberFicha.js';
export { expurgar } from './expurgar.js';
export { publicarMetodo } from './publicarMetodo.js';
export { coletarMinima } from './coletarMinima.js';
export { coletar } from './coletar.js';
export { sintetizar } from './sintetizar.js';
export { verificar } from './verificar.js';
export { sondarCache } from './sondarCache.js';
export { vigiar } from './vigiar.js';
