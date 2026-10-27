import type { Page } from '@playwright/test';

export const areaIds = ['cff8f591-448b-49d9-8eb3-dd3488b89f98', 'b77ce5bd-0ec5-4ce9-9fad-fabbcab3db02', '29a35b1c-fc38-babf-b756-a71e292671b5'];
export const areaFixtures = ['Salão de festas', 'Churrasqueira', 'Espaço gourmet'].map((name, index) => ({
  id: areaIds[index], name, capacity: 40, opensAt: '08:00', closesAt: '22:00', requiresApproval: true,
  maxHoursPerBooking: 6, monthlyLimitPerUnit: 1, monthlyLimitPerResident: 2,
}));
export const bookings = areaFixtures.map((area, index) => ({
  id: `10000000-0000-4000-8000-00000000000${index}`, areaId: area.id, userId: 'resident', unit: index ? 'Unidade DEMO' : '101',
  startsAt: `2026-11-0${index + 1}T17:00:00.000Z`, endsAt: `2026-11-0${index + 1}T19:00:00.000Z`, status: index === 2 ? 'CONFIRMED' : 'PENDING', notes: 'Encontro em família.',
}));

export async function prepareAreas(page: Page, options: { failure?: boolean; manager?: boolean; areaDelay?: Promise<void>; decisionDelay?: Promise<void>; refreshDelay?: Promise<void>; decisionFailure?: boolean; cancellationDelay?: Promise<void>; cancellationFailure?: boolean } = {}) {
  let areasFail = options.failure ?? false;
  let decisionFail = options.decisionFailure ?? false;
  let cancellationFail = options.cancellationFailure ?? false;
  let spaces = areaFixtures.map(item => ({ ...item }));
  let current = bookings.map(item => ({ ...item }));
  const writes: Array<{ id: string; status: string }> = [];
  const areaWrites: Array<{ id?: string; monthlyLimitPerUnit: number | null }> = [];
  const user = { id: 'usr_areas', name: 'Marina Silva', email: 'areas@example.test', role: 'BUILDING_ADMIN', memberships: [{ buildingId: 'bld_001', role: 'BUILDING_ADMIN' }] };
  await page.route('http://127.0.0.1:3194/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === '/auth/web/refresh') return route.fulfill({ json: { accessToken: 'areas-local-test', user } });
    if (path === '/auth/me') return route.fulfill({ json: user });
    if (path === '/buildings') return route.fulfill({ json: { items: [{ id: 'bld_001', name: 'Condomínio Vista Verde', active: true }] } });
    if (path === '/buildings/bld_001') return route.fulfill({ json: { name: 'Condomínio Vista Verde', address: {} } });
    if (path === '/v1/authorization') return route.fulfill({ json: { capabilities: ['devices:read', 'telemetry:read', 'alerts:read', 'occurrences:manage', 'gates:manage', 'alert-rules:read', 'finance:read', 'parking:read', 'audit:read', 'common-areas:read', ...(options.manager === false ? [] : ['reservations:manage', 'common-areas:manage'])] } });
    if (path === '/features/buildings/bld_001') return route.fulfill({ json: { items: ['RESERVATIONS', 'WATER_TANK', 'ENERGY_CONSUMPTION', 'GAS', 'GARAGE_ACCESS', 'CAR_PARKING', 'TICKETS', 'FINANCE'].map(key => ({ key, enabled: true, version: 1, globalVersion: 1 })) } });
    if (path === '/events/stream') return route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    if (path === '/common-areas') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        areaWrites.push(body);
        const created = { ...body, id: 'new-area' };
        spaces.push(created);
        return route.fulfill({ status: 201, json: created });
      }
      await options.areaDelay;
      return areasFail ? route.fulfill({ status: 500, json: { error: 'Não foi possível salvar ou consultar as áreas comuns' } }) : route.fulfill({ json: { items: spaces } });
    }
    if (path.startsWith('/common-areas/') && request.method() === 'PATCH') {
      const id = path.split('/')[2], body = request.postDataJSON();
      areaWrites.push({ id, ...body });
      spaces = spaces.map(item => item.id === id ? { ...item, ...body } : item);
      return route.fulfill({ json: spaces.find(item => item.id === id) });
    }
    if (path === '/reservations') { if (writes.length) await options.refreshDelay; return route.fulfill({ json: { items: current } }); }
    if (path === '/reservations/calendar') { if (writes.length) await options.refreshDelay; return route.fulfill({ json: { reservations: current.filter(item => item.areaId === url.searchParams.get('areaId')).map(item => ({ ...item, requesterName: 'João Silva' })), events: [] } }); }
    if (path.endsWith('/decision')) {
      const id = path.split('/')[2], { status } = request.postDataJSON();
      writes.push({ id, status });
      await options.decisionDelay;
      if (decisionFail) return route.fulfill({ status: 503, json: { error: 'Não foi possível aprovar agora. Tente novamente.' } });
      current = current.map(item => item.id === id ? { ...item, status } : item);
      return route.fulfill({ json: current.find(item => item.id === id) });
    }
    if (path.startsWith('/reservations/') && request.method() === 'DELETE') {
      const id = path.split('/')[2];
      writes.push({ id, status: 'CANCELLED' });
      await options.cancellationDelay;
      if (cancellationFail) return route.fulfill({ status: 503, json: { error: 'Não foi possível cancelar agora. Tente novamente.' } });
      current = current.map(item => item.id === id ? { ...item, status: 'CANCELLED' } : item);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: { items: [] } });
  });
  return { writes, areaWrites, recoverAreas: () => { areasFail = false; }, recoverDecision: () => { decisionFail = false; }, recoverCancellation: () => { cancellationFail = false; } };
}
