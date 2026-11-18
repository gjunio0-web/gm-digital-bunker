// Site-wide constants.
// DOMINIO (the site's absolute origin) and INDEXAVEL (whether search engines may index the build)
// are decided in src/lib/origem.mjs, which astro.config.mjs also imports.
import { EM_PRODUCAO } from './lib/origem.mjs';
export { DOMINIO, INDEXAVEL, EM_PRODUCAO } from './lib/origem.mjs';
export const EMAIL_CONTATO = 'contato@gmdigitalbunker.com.br';
// Contact form backend: the receberFicha function (spec 01), one Firebase project per environment.
// Production builds post to gmdb-producao, every other build to gmdb-qualidade.
// FORMULARIO_EM_PRODUCAO switches the form off in production only (fields disabled, with notice and
// e-mail). On: receberFicha deployed in gmdb-producao with the hub release, requested by Gon (2026-11-18).
const FORMULARIO_EM_PRODUCAO = true;
export const FORMULARIO_ATIVO = EM_PRODUCAO ? FORMULARIO_EM_PRODUCAO : true;
export const FUNCAO_RECEBER_FICHA = EM_PRODUCAO
  ? 'https://southamerica-east1-gmdb-producao.cloudfunctions.net/receberFicha'
  : 'https://southamerica-east1-gmdb-qualidade.cloudfunctions.net/receberFicha';
export const MARCA = 'GM Digital Bunker™';
// External addresses, per the stage-1 content doc
export const AMAZON = 'https://www.amazon.com.br/dp/B0H7QR7DZ7';
export const AMAZON_EN = 'https://www.amazon.com/dp/B0H7QR7DZ7'; // US store, for the English pages
export const LINKEDIN = 'https://www.linkedin.com/in/gjunio0';
// AI Strategy Hub, paired with the build environment like the form backend above: production builds
// link to and read from the production Hub; every other build uses the Hub's quality_env deploy, so the
// quality site shows (and opens) the articles of the quality Hub. Spec 06, §5.1.
export const HUB = EM_PRODUCAO ? 'https://ai-strat-hub.netlify.app' : 'https://quality-env--ai-strat-hub.netlify.app';
// Admin hub (spec 05): public Firebase web configuration, one app per environment. These values identify
// the Firebase project to the browser and are public by design; access is enforced by Firebase Auth and
// the Firestore rules. The production app does not exist yet, so production builds get null and the hub
// shows that it is not configured.
export const FIREBASE_WEB = EM_PRODUCAO
  ? null
  : {
      apiKey: 'AIzaSyAKGjUHAjPXpJphfrmc9JhUJzh7jkicyWo',
      authDomain: 'gmdb-qualidade.firebaseapp.com',
      projectId: 'gmdb-qualidade',
      storageBucket: 'gmdb-qualidade.firebasestorage.app',
      messagingSenderId: '91928500287',
      appId: '1:91928500287:web:3a728812d21a1d5177808a',
    };
