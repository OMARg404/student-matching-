'use strict';
/**
 * Turns the algorithm's internal result into the API response defined in docs/04-api-contract.md.
 * Framework-free: validate + build the response body. Any HTTP server can call these.
 */
const { matchStudent, suggestPossibleMatches } = require('./matching');
const { searchStudents } = require('./search');
const { normalizeIdentifier } = require('./normalize');

/** Which algorithm method maps to which public status. */
const STATUS_BY_METHOD = {
    code_exact: 'matched',
    code_one_digit_off: 'matched',   // auto-corrected -> matched, but flagged review_recommended
    phone_unique: 'matched',         // auto-corrected -> matched, but flagged review_recommended
    name_only: 'needs_review',       // a single suggested student, must be confirmed by a human
    code_name_mismatch: 'needs_review',
    code_name_conflict: 'conflict',  // two real students both fit -> human picks one
    none: 'not_found'
};

const AUTO_CORRECTED = new Set(['code_one_digit_off', 'phone_unique']);

/** Public shape of a student in every response (never leak internal fields). */
function publicStudent(s, extra = {}) {
    if (!s) return null;
    return {
        student_code: s.student_code,
        name: s.name,
        group: s.group || null,
        year: s.year || null,
        ...extra
    };
}

function cleanText(v) {
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t.length ? t : null;
}

/**
 * @returns {{ok: true, value: object} | {ok: false, error: {code: string, message: string, field?: string}}}
 */
function validateMatchRequest(body) {
    if (!body || typeof body !== 'object') {
        return { ok: false, error: { code: 'INVALID_JSON', message: 'Request body must be a JSON object' } };
    }
    if (!cleanText(body.request_id)) {
        return { ok: false, error: { code: 'MISSING_FIELD', field: 'request_id', message: 'request_id is required' } };
    }
    if (!body.exam || !cleanText(body.exam.id)) {
        return { ok: false, error: { code: 'MISSING_FIELD', field: 'exam.id', message: 'exam.id is required' } };
    }
    const ex = body.extracted || {};
    const extracted = {
        student_code: cleanText(ex.student_code) ? normalizeIdentifier(ex.student_code) : null,
        student_name: cleanText(ex.student_name),
        student_phone: cleanText(ex.student_phone) ? normalizeIdentifier(ex.student_phone) : null
    };
    if (!extracted.student_code && !extracted.student_name && !extracted.student_phone) {
        return { ok: false, error: { code: 'NOTHING_EXTRACTED', message: 'At least one of extracted.student_code / student_name / student_phone is required' } };
    }
    return {
        ok: true,
        value: {
            request_id: cleanText(body.request_id),
            exam: { id: cleanText(body.exam.id), name: cleanText(body.exam.name), form: cleanText(body.exam.form) },
            extracted
        }
    };
}

/**
 * Run the full match for one paper and build the response body.
 * @param {Array} students - the roster
 * @param {object} req - a validated request (validateMatchRequest(...).value)
 */
function buildMatchResponse(students, req) {
    const { student_code, student_name, student_phone } = req.extracted;
    const result = matchStudent(students, student_code, student_name, student_phone);
    const status = STATUS_BY_METHOD[result.method];

    const candidates = status === 'matched'
        ? []
        : suggestPossibleMatches(
            { extractedCode: student_code, extractedName: student_name, candidates: result.candidates },
            students
        ).map((s) => publicStudent(s, { reason: s.reason || null }));

    return {
        request_id: req.request_id,
        status,
        method: result.method,
        review_recommended: status !== 'matched' || AUTO_CORRECTED.has(result.method),
        student: status === 'matched' ? publicStudent(result.matchedStudent) : null,
        suggested_student: status === 'needs_review' && result.matchedStudent ? publicStudent(result.matchedStudent) : null,
        candidates,
        note_ar: result.matchNote
    };
}

/**
 * GET /students/search?q=...&limit=...
 */
function buildSearchResponse(students, query, limit = 10) {
    const q = cleanText(query);
    if (!q) return { ok: false, error: { code: 'MISSING_FIELD', field: 'q', message: 'q is required' } };
    const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    const all = searchStudents(students, q);
    return { ok: true, value: { query: q, total: all.length, results: all.slice(0, n).map((s) => publicStudent(s)) } };
}

module.exports = { validateMatchRequest, buildMatchResponse, buildSearchResponse, STATUS_BY_METHOD };
