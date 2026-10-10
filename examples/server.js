'use strict';
/**
 * Reference implementation of the API in docs/04-api-contract.md — zero framework, Node >= 18.
 *
 *   API_TOKEN=change-me node examples/server.js
 *   PORT=8080 ROSTER_FILE=./my-roster.json API_TOKEN=... node examples/server.js
 *
 * The roster here is a JSON file loaded into memory. In your platform, replace `loadRoster()`
 * with your real students table. Everything else can stay as is.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateMatchRequest, buildMatchResponse, buildSearchResponse } = require('../src/api');
const { prepareRoster } = require('../src/normalize');

const PORT = Number(process.env.PORT) || 8080;
const API_TOKEN = process.env.API_TOKEN || '';
const ROSTER_FILE = process.env.ROSTER_FILE || path.join(__dirname, 'roster.sample.json');
const MAX_BODY_BYTES = 64 * 1024;

if (!API_TOKEN) {
    console.error('Set API_TOKEN (the Bearer token the grading platform will send). Refusing to start without auth.');
    process.exit(1);
}

function loadRoster() {
    // Each student needs at least: student_code, name. phone/group/year are optional.
    // prepareRoster runs once here (not per request): string codes + one phone format.
    return prepareRoster(JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8')));
}
let students = loadRoster();


function send(res, status, body) {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) });
    res.end(json);
}

function sendError(res, status, error) {
    send(res, status, { error });
}

function authorized(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const a = Buffer.from(token);
    const b = Buffer.from(API_TOKEN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { code: 'PAYLOAD_TOO_LARGE' })); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
            catch { reject(Object.assign(new Error('bad json'), { code: 'INVALID_JSON' })); }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
        if (url.pathname === '/health') return send(res, 200, { ok: true, students: students.length });
        if (!authorized(req)) return sendError(res, 401, { code: 'UNAUTHORIZED', message: 'Missing or invalid Bearer token' });

        if (req.method === 'POST' && url.pathname === '/v1/papers/match') {
            let body;
            try { body = await readJson(req); } catch (e) {
                return sendError(res, e.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { code: e.code, message: e.message });
            }
            const v = validateMatchRequest(body);
            if (!v.ok) return sendError(res, 400, v.error);

            const response = buildMatchResponse(students, v.value);
            return send(res, 200, response);
        }

        if (req.method === 'GET' && url.pathname === '/v1/students/search') {
            const r = buildSearchResponse(students, url.searchParams.get('q'), url.searchParams.get('limit'));
            if (!r.ok) return sendError(res, 400, r.error);
            return send(res, 200, r.value);
        }

        return sendError(res, 404, { code: 'NOT_FOUND', message: 'Unknown endpoint' });
    } catch (err) {
        console.error(err);
        return sendError(res, 500, { code: 'INTERNAL_ERROR', message: 'Unexpected server error' });
    }
});

if (require.main === module) {
    server.listen(PORT, () => console.log(`student-matching reference API on :${PORT} (${students.length} students)`));
}

module.exports = { server, _reloadRoster: () => { students = loadRoster(); } };
