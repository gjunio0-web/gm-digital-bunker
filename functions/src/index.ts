// Cloud Functions entry point (spec 01). Item 1: reception of the form and the daily purge; item 3: qualification; item 4: collection; item 5: method publication.
import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { receberFicha } from './receberFicha.js';
export { expurgar } from './expurgar.js';
export { qualificar } from './qualificar.js';
export { publicarMetodo } from './publicarMetodo.js';
export { coletar } from './coletar.js';
