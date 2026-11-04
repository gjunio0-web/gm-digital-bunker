// Cloud Functions entry point (spec 01). Item 1: reception of the form and the daily purge.
import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { receberFicha } from './receberFicha.js';
export { expurgar } from './expurgar.js';
