// Month key of metricas in São Paulo time (aaaa-mm). Small module so that receberFicha does not load qualificar.
export const mesDe = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
