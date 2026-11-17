// Module registry of the admin hub (spec 05, §4). Adding a module means adding a folder under
// src/admin/ and one entry here, without touching the others.
import type { Firestore } from 'firebase/firestore';
import * as leads from './leads';

import type { ChamaAcao } from './leads/acoes';

export interface ModuloContexto {
  db: Firestore;
  /** Navigates inside the hub (History API), without reloading the page. */
  ir: (caminho: string) => void;
  /** Call of the `acaoAdmin` function (spec 05 §5.7.1). */
  chamaAcao: ChamaAcao;
}

export interface Modulo {
  id: string;
  nome: string;
  descricao: string;
  /** Internal route prefix, e.g. "/admin/leads"; null while the module is under construction. */
  rota: string | null;
  estado: 'ativo' | 'em_construcao';
  /** Status line for the module card, read after sign-in (optional). */
  status?: (db: Firestore) => Promise<string>;
  /** Renders the view for a path under `rota` into `alvo`. */
  render?: (alvo: HTMLElement, caminho: string, ctx: ModuloContexto) => void | (() => void);
}

export const MODULOS: Modulo[] = [
  {
    id: 'leads',
    nome: 'Leads',
    descricao:
      'Fichas do formulário de contato, ordenadas por quadrante e grau de qualificação, com a análise preliminar de cada empresa e a geração da avaliação em quatro formatos.',
    rota: '/admin/leads',
    estado: 'ativo',
    status: leads.status,
    render: leads.render,
  },
  {
    id: 'financeiro',
    nome: 'Financeiro',
    descricao: 'Gestão financeira da prática: propostas, faturamento e acompanhamento por cliente.',
    rota: null,
    estado: 'em_construcao',
  },
];
