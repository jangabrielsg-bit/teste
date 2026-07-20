export function paraISO(d) {
  const ano = d.getFullYear(),
    mes = String(d.getMonth() + 1).padStart(2, '0'),
    dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function amanhaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return paraISO(d);
}

/** Soma (ou subtrai, com delta negativo) dias a uma data ISO (YYYY-MM-DD) arbitrária. */
export function somarDiasISO(iso, delta) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return paraISO(d);
}

export function hojeISO() {
  return paraISO(new Date());
}

export function formatarDataBR(iso) {
  if (!iso || iso.indexOf('-') === -1) return iso;
  const [a, m, d] = iso.split('-');
  const data = new Date(a, parseInt(m, 10) - 1, d);
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  return `${d}/${m}/${a} (${dias[data.getDay()]})`;
}

export function horaCurta(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatarHoraData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const aa = String(d.getFullYear()).slice(-2);
  return `${hh}:${mm} ${dd}/${mo}/${aa}`;
}

export function formatarKg(n) {
  return (n || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
