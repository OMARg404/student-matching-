'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.API_TOKEN = 'test-token';
const { server } = require('../examples/server');

let base;
before(() => new Promise((resolve) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); })));
after(() => new Promise((resolve) => server.close(resolve)));

const call = (path, { method = 'GET', body, token = 'test-token' } = {}) =>
    fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

describe('reference server', () => {
    it('rejects missing/wrong token with 401', async () => {
        assert.equal((await call('/v1/students/search?q=1', { token: null })).status, 401);
        assert.equal((await call('/v1/students/search?q=1', { token: 'nope' })).status, 401);
    });

    it('POST /v1/papers/match -> matched, then duplicate on a second paper of the same student', async () => {
        const first = await call('/v1/papers/match', { method: 'POST', body: { request_id: 'p1', exam: { id: 'ex1' }, extracted: { student_code: '1001', student_name: 'أحمد محمد' } } });
        assert.equal(first.status, 200);
        assert.equal(first.body.status, 'matched');
        assert.equal(first.body.duplicate_of, null);

        const retry = await call('/v1/papers/match', { method: 'POST', body: { request_id: 'p1', exam: { id: 'ex1' }, extracted: { student_code: '1001', student_name: 'أحمد محمد' } } });
        assert.equal(retry.body.duplicate_of, null, 'same request_id retried is not a duplicate');

        const second = await call('/v1/papers/match', { method: 'POST', body: { request_id: 'p2', exam: { id: 'ex1' }, extracted: { student_phone: '01000000001' } } });
        assert.equal(second.body.status, 'matched');
        assert.equal(second.body.duplicate_of, 'p1');
    });

    it('400 with a machine-readable error code on bad input', async () => {
        const r = await call('/v1/papers/match', { method: 'POST', body: { request_id: 'p3', exam: { id: 'ex1' }, extracted: {} } });
        assert.equal(r.status, 400);
        assert.equal(r.body.error.code, 'NOTHING_EXTRACTED');
    });

    it('GET /v1/students/search', async () => {
        const r = await call('/v1/students/search?q=' + encodeURIComponent('سارة'));
        assert.equal(r.status, 200);
        assert.equal(r.body.results[0].student_code, '1002');
    });

    it('404 on unknown endpoint', async () => {
        assert.equal((await call('/v1/nope')).status, 404);
    });
});
