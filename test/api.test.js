'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateMatchRequest, buildMatchResponse, buildSearchResponse } = require('../src/api');
const { searchStudents } = require('../src/search');
const { normalizeAr } = require('../src/normalize');
const roster = require('../examples/roster.sample.json');

const req = (extracted, extra = {}) => {
    const v = validateMatchRequest({ request_id: 'r1', exam: { id: 'e1', name: 'Exam 1', form: 'A' }, extracted, ...extra });
    assert.equal(v.ok, true, JSON.stringify(v.error));
    return v.value;
};

describe('validateMatchRequest', () => {
    it('rejects missing request_id / exam.id / empty extraction', () => {
        assert.equal(validateMatchRequest({ exam: { id: 'e' }, extracted: { student_code: '1' } }).error.code, 'MISSING_FIELD');
        assert.equal(validateMatchRequest({ request_id: 'r', extracted: { student_code: '1' } }).error.field, 'exam.id');
        assert.equal(validateMatchRequest({ request_id: 'r', exam: { id: 'e' }, extracted: { student_name: '  ' } }).error.code, 'NOTHING_EXTRACTED');
        assert.equal(validateMatchRequest(null).error.code, 'INVALID_JSON');
    });
    it('normalizes Arabic digits and spaces in code/phone', () => {
        const v = req({ student_code: '١٠٠١', student_phone: '010 0000 0001' });
        assert.equal(v.extracted.student_code, '1001');
        assert.equal(v.extracted.student_phone, '01000000001');
    });
});

describe('buildMatchResponse', () => {
    it('matched by exact code + name', () => {
        const r = buildMatchResponse(roster, req({ student_code: '1001', student_name: 'احمد محمد' }));
        assert.equal(r.status, 'matched');
        assert.equal(r.method, 'code_exact');
        assert.equal(r.review_recommended, false);
        assert.equal(r.student.student_code, '1001');
        assert.deepEqual(r.candidates, []);
    });
    it('matched via phone is flagged review_recommended', () => {
        const r = buildMatchResponse(roster, req({ student_code: '9999', student_phone: '01100000005' }));
        assert.equal(r.status, 'matched');
        assert.equal(r.method, 'phone_unique');
        assert.equal(r.review_recommended, true);
        assert.equal(r.student.student_code, '2052');
    });
    it('conflict returns both students', () => {
        const r = buildMatchResponse(roster, req({ student_code: '1001', student_name: 'سارة علي حسن' }));
        assert.equal(r.status, 'conflict');
        assert.deepEqual(r.candidates.map((c) => [c.student_code, c.reason]), [['1001', 'code'], ['1002', 'name']]);
        assert.equal(r.student, null);
    });
    it('name only -> needs_review with a suggested student', () => {
        const r = buildMatchResponse(roster, req({ student_name: 'يوسف خالد' }));
        assert.equal(r.status, 'needs_review');
        assert.equal(r.suggested_student.student_code, '3107');
        assert.equal(r.student, null);
    });
    it('code exists but name unrelated -> needs_review with the code owner as candidate', () => {
        const r = buildMatchResponse(roster, req({ student_code: '1003', student_name: 'زياد' }));
        assert.equal(r.status, 'needs_review');
        assert.equal(r.method, 'code_name_mismatch');
        assert.deepEqual(r.candidates.map((c) => c.student_code), ['1003']);
    });
    it('nothing matches -> not_found', () => {
        const r = buildMatchResponse(roster, req({ student_code: '7777', student_name: 'زياد' }));
        assert.equal(r.status, 'not_found');
        assert.deepEqual(r.candidates, []);
    });
    it('flags a duplicate for the same exam, and only the same exam', () => {
        const prev = [{ id: 'old1', exam_id: 'e1', student_id: 's1', extracted_name: null, extracted_code: '1001' }];
        assert.equal(buildMatchResponse(roster, req({ student_code: '1001' }), prev).duplicate_of, 'old1');
        const other = [{ ...prev[0], exam_id: 'e2' }];
        assert.equal(buildMatchResponse(roster, req({ student_code: '1001' }), other).duplicate_of, null);
    });
    it('a retried request_id is never a duplicate of itself', () => {
        const prev = [{ id: 'r1', exam_id: 'e1', student_id: 's1', extracted_name: null, extracted_code: '1001' }];
        assert.equal(buildMatchResponse(roster, req({ student_code: '1001' }), prev).duplicate_of, null);
    });
});

describe('search', () => {
    it('exact code first, then partial codes', () => {
        const r = searchStudents(roster, '205');
        assert.deepEqual(r.map((s) => s.student_code), ['2051', '2052', '2053']);
        assert.equal(searchStudents(roster, '2052')[0].student_code, '2052');
    });
    it('Arabic digits work for codes', () => {
        assert.equal(searchStudents(roster, '٣١٠٧')[0].student_code, '3107');
    });
    it('name search tolerates spelling variants', () => {
        assert.equal(searchStudents(roster, 'مى عادل')[0].student_code, '2052');
        assert.equal(searchStudents(roster, 'عبدالرحمن')[0].student_code, '2051');
        assert.equal(searchStudents(roster, 'يوسف خالد عبدالله')[0].student_code, '3107');
    });
    it('short query matches word starts only', () => {
        const codes = searchStudents(roster, 'مي').map((s) => s.student_code);
        assert.ok(codes.includes('2052'));
    });
    it('buildSearchResponse caps limit and validates q', () => {
        assert.equal(buildSearchResponse(roster, '').ok, false);
        const r = buildSearchResponse(roster, '205', 1);
        assert.equal(r.value.total, 3);
        assert.equal(r.value.results.length, 1);
    });
});

describe('normalizeAr', () => {
    it('folds the common variants', () => {
        assert.equal(normalizeAr('أحمد'), normalizeAr('احمد'));
        assert.equal(normalizeAr('مى'), 'مي');
        assert.equal(normalizeAr('عبد الله'), normalizeAr('عبدالله')); // both -> 'عبداله' (doubled letters collapse)
        assert.equal(normalizeAr('عاادل'), 'عادل');
        assert.equal(normalizeAr('١٠٠١'), '1001');
    });
});
