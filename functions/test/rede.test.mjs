// Phase 6, item 1 – guarded fetch of user-supplied URLs: address forms the Node URL parser rewrites (hex
// IPv4-mapped IPv6, decimal and hex IPv4), translation prefixes, redirects to internal addresses and the
// connection pinned to the checked address (no second resolution between the check and the access).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { buscaPagina, exigeEnderecoPublico, ipPrivado } from '../lib/coleta/rede.js';

test('address forms: hex IPv4-mapped, NAT64, 6to4, Teredo, decimal and hex IPv4 are refused', async () => {
  for (const u of [
    'http://[::ffff:169.254.169.254]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[64:ff9b::a9fe:a9fe]/',
    'http://[2002:a9fe:a9fe::]/', 'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/', 'http://2852039166/', 'http://0xa9.0xfe.0xa9.0xfe/', 'http://0251.0376.0251.0376/',
    'http://[::]/', 'http://[fe80::1]/', 'http://[fd12::1]/', 'http://[2001:db8::1]/',
    // Deprecated IPv4-compatible form (::/96), even with a public IPv4 inside
    'http://[::169.254.169.254]/', 'http://[::a9fe:a9fe]/', 'http://[::127.0.0.1]/', 'http://[::8.8.8.8]/',
  ]) await assert.rejects(exigeEnderecoPublico(new URL(u)), /address not allowed/, u);
  assert.equal(ipPrivado('::ffff:a9fe:a9fe'), true);
  assert.equal(ipPrivado('::ffff:8.8.8.8'), false);
  assert.equal(ipPrivado('2001:4860:4860::8888'), false);
  assert.equal(ipPrivado('::a9fe:a9fe'), true);
  assert.equal(ipPrivado('::808:808'), true);
  assert.equal(ipPrivado('nao-e-ip'), true);
  // The IPv4 list of before is kept.
  for (const ip of ['0.1.2.3', '100.64.0.1', '198.18.0.1', '192.0.0.1', '255.255.255.255']) assert.equal(ipPrivado(ip), true, ip);
});

// A local server stands for a public site: the test treats 127.0.0.1 as public and gives fictitious host names.
async function servidor(rotas) {
  const s = createServer((req, res) => {
    const r = rotas[req.url] ?? { status: 404 };
    res.writeHead(r.status, { 'content-type': 'text/html', ...(r.location ? { location: r.location(s.address().port) } : {}) });
    res.end(r.corpo ?? '');
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return s;
}
const publicoNoTeste = (ip) => ip === '127.0.0.1';

test('connection pinned to the checked address: one resolution per hop, the fetch never resolves again', async () => {
  const s = await servidor({ '/': { status: 200, corpo: '<p>ok</p>' } });
  try {
    let chamadas = 0;
    // A rebinding resolver: public address on the first answer, internal on any later one.
    const resolve = async () => (chamadas++ === 0 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.0.0.9', family: 4 }]);
    const p = await buscaPagina(`http://site-publico.test:${s.address().port}/`, resolve, publicoNoTeste);
    assert.equal(p.status, 200);
    assert.equal(p.corpo, '<p>ok</p>');
    // "site-publico.test" does not exist in DNS: the page came only because the connection used the checked IP.
    assert.equal(chamadas, 1);
  } finally {
    s.close();
  }
});

test('redirect to an internal address is refused at the hop', async () => {
  const s = await servidor({ '/': { status: 302, location: (porta) => `http://interno.test:${porta}/segredo` } });
  try {
    const resolve = async (host) => (host === 'interno.test' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
    await assert.rejects(buscaPagina(`http://site-publico.test:${s.address().port}/`, resolve, (ip) => ip === '127.0.0.1'), /address not allowed/);
    // And to the metadata server written as hex IPv4-mapped IPv6, with the real guard.
    const s2 = await servidor({ '/': { status: 302, location: () => 'http://[::ffff:169.254.169.254]/computeMetadata/v1/' } });
    try {
      await assert.rejects(buscaPagina(`http://site-publico.test:${s2.address().port}/`, async () => [{ address: '127.0.0.1', family: 4 }], (ip) => ip === '127.0.0.1' || !ipPrivado(ip)), /address not allowed/);
    } finally {
      s2.close();
    }
  } finally {
    s.close();
  }
});
