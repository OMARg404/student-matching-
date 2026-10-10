'use strict';
// Ported 1:1 from the production test-suite, plus Arabic cases.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchStudent, nameMatchScore, namesPlausiblyMatch, suggestPossibleMatches, isOneDigitOff } = require('../src/matching');

const students = [
    { id: 's1', name: 'Ahmed Mohamed Ali', student_code: '1001', phone: '01000000001' },
    { id: 's2', name: 'Sara Ali Hassan', student_code: '1002', phone: '01000000002' },
    { id: 's3', name: 'Mona Hassan Kamal', student_code: '1003', phone: '01000000003' }
];

describe('matchStudent', () => {
    it('matches purely by exact code when no name was extracted', () => {
        const r = matchStudent(students, '1001', '');
        assert.equal(r.matchedStudent.id, 's1');
        assert.equal(r.status, 'matched');
        assert.equal(r.method, 'code_exact');
    });

    it('exact code + a name with zero words in common stays unmatched (needs review)', () => {
        const r = matchStudent(students, '1001', 'Completely Different Person');
        assert.equal(r.matchedStudent, null);
        assert.equal(r.status, 'unmatched');
        assert.equal(r.method, 'code_name_mismatch');
    });

    it('flags a genuine code/name conflict and returns both candidates explicitly', () => {
        const r = matchStudent(students, '1001', 'Sara Ali Hassan');
        assert.equal(r.matchedStudent, null);
        assert.equal(r.status, 'unmatched');
        assert.equal(r.method, 'code_name_conflict');
        assert.deepEqual(r.candidates.map((c) => c.student.id).sort(), ['s1', 's2']);
        assert.deepEqual(r.candidates.map((c) => c.reason), ['code', 'name']);
    });

    it('a code match whose name shares ONE word with another student is not a conflict', () => {
        // "Ali" appears in both s1 and s2 — a single shared word is below the strong threshold (2)
        const r = matchStudent(students, '1001', 'Ahmed Ali');
        assert.equal(r.status, 'matched');
        assert.equal(r.matchedStudent.id, 's1');
    });

    it('auto-confirms a one-digit-off code when exactly one near-miss candidate exists and the name plausibly matches', () => {
        // '2001' is one digit off from '1001' only (two digits off from '1002'/'1003')
        const r = matchStudent(students, '2001', 'Ahmed Mohamed Ali');
        assert.equal(r.matchedStudent.id, 's1');
        assert.equal(r.status, 'matched');
        assert.equal(r.method, 'code_one_digit_off');
        assert.match(r.matchNote, /تقارب/);
    });

    it('does not auto-confirm a one-digit-off code when the name does not plausibly match', () => {
        const r = matchStudent(students, '2001', 'Someone Else Entirely');
        assert.equal(r.matchedStudent, null);
        assert.equal(r.status, 'unmatched');
    });

    it('does not use one-digit-off when several students are one digit away', () => {
        // '1000' is one digit off from 1001, 1002 AND 1003
        const r = matchStudent(students, '1000', 'Ahmed Mohamed Ali');
        assert.notEqual(r.method, 'code_one_digit_off');
        assert.equal(r.status, 'unmatched');
    });

    it('falls back to name-only matching when no code was extracted at all', () => {
        const r = matchStudent(students, null, 'Mona Hassan Kamal');
        assert.equal(r.matchedStudent.id, 's3');
        assert.equal(r.status, 'unmatched'); // name-only match still requires human confirmation
        assert.equal(r.method, 'name_only');
    });

    it('name-only gives nothing when the top two names tie', () => {
        const r = matchStudent(students, null, 'Hassan'); // s2 and s3 both have "Hassan"
        assert.equal(r.matchedStudent, null);
        assert.equal(r.method, 'none');
    });

    it('returns fully unmatched when neither code nor name yield anything', () => {
        const r = matchStudent(students, null, '');
        assert.equal(r.matchedStudent, null);
        assert.equal(r.status, 'unmatched');
        assert.equal(r.candidates, undefined);
        assert.equal(r.method, 'none');
    });

    describe('phone-based matching', () => {
        it('auto-confirms via an exact, unique phone match when the code does not match any student', () => {
            const r = matchStudent(students, '9999', '', '01000000002');
            assert.equal(r.matchedStudent.id, 's2');
            assert.equal(r.status, 'matched');
            assert.equal(r.method, 'phone_unique');
            assert.match(r.matchNote, /الهاتف/);
        });

        it('does not use phone as a tiebreaker when it matches more than one student', () => {
            const dup = [...students, { id: 's4', name: 'Other', student_code: '1004', phone: '01000000002' }];
            const r = matchStudent(dup, '9999', '', '01000000002');
            assert.equal(r.matchedStudent, null);
            assert.equal(r.status, 'unmatched');
        });

        it('never consults phone when an exact code match already exists (code path takes priority)', () => {
            const r = matchStudent(students, '1001', '', '01000000002');
            assert.equal(r.matchedStudent.id, 's1');
        });

        it('ignores a phone that matches nobody, falling through to the normal unmatched result', () => {
            const r = matchStudent(students, '9999', '', '01999999999');
            assert.equal(r.matchedStudent, null);
            assert.equal(r.status, 'unmatched');
        });
    });

    describe('Arabic names', () => {
        const ar = [
            { id: 'a1', name: 'أحمد محمد علي', student_code: '1001' },
            { id: 'a2', name: 'سارة علي حسن', student_code: '1002' },
            { id: 'a3', name: 'منى حسن كمال', student_code: '1003' }
        ];
        it('tolerates alef / taa-marbuta / yaa variants', () => {
            const r = matchStudent(ar, '1002', 'ساره على حسن');
            assert.equal(r.status, 'matched');
            assert.equal(r.matchedStudent.id, 'a2');
        });
        it('detects an Arabic code/name conflict', () => {
            const r = matchStudent(ar, '1001', 'منى حسن كمال');
            assert.equal(r.method, 'code_name_conflict');
        });
    });
});

describe('nameMatchScore / namesPlausiblyMatch', () => {
    it('scores by count of matching words, tolerant of Arabic letter variants', () => {
        assert.equal(nameMatchScore('احمد محمد', 'أحمد محمد علي'), 2);
        assert.equal(namesPlausiblyMatch('منى', 'منى حسن'), true);
    });
    it('returns 0 and false for names with no overlapping words at all', () => {
        assert.equal(nameMatchScore('Ahmed', 'Sara'), 0);
        assert.equal(namesPlausiblyMatch('Ahmed', 'Sara'), false);
    });
    it('ignores 1-letter words', () => {
        assert.equal(nameMatchScore('A', 'Ahmed'), 0);
    });
});

describe('isOneDigitOff', () => {
    it('true only for same length + exactly one different character', () => {
        assert.equal(isOneDigitOff('1001', '1002'), true);
        assert.equal(isOneDigitOff('1001', '1001'), false);
        assert.equal(isOneDigitOff('1001', '2002'), false);
        assert.equal(isOneDigitOff('1001', '10011'), false);
    });
});

describe('suggestPossibleMatches', () => {
    it('returns explicit conflict candidates first, with their reason', () => {
        const r = matchStudent(students, '1001', 'Sara Ali Hassan');
        const s = suggestPossibleMatches({ extractedCode: '1001', extractedName: 'Sara Ali Hassan', candidates: r.candidates }, students);
        assert.deepEqual(s.map((x) => [x.id, x.reason]), [['s1', 'code'], ['s2', 'name']]);
    });
    it('otherwise: exact code owner + normalized name containment', () => {
        const ar = [{ id: 'x1', name: 'مي عادل', student_code: '5' }, { id: 'x2', name: 'عبدالله سمير', student_code: '6' }];
        assert.deepEqual(suggestPossibleMatches({ extractedName: 'مى عادل' }, ar).map((s) => s.id), ['x1']);
        // plain substring containment: a very short name like "مي" also hits "سمير" — that's why this is only a suggestion list
        assert.deepEqual(suggestPossibleMatches({ extractedName: 'مى' }, ar).map((s) => s.id), ['x1', 'x2']);
        assert.deepEqual(suggestPossibleMatches({ extractedName: 'عبد الله' }, ar).map((s) => s.id), ['x2']);
        assert.deepEqual(suggestPossibleMatches({ extractedCode: '6' }, ar).map((s) => s.id), ['x2']);
    });
});

describe('real-world roster shapes', () => {
    const { prepareRoster, normalizePhone } = require('../src/normalize');

    it('detects a conflict even when students have no `id` field', () => {
        const noId = [{ student_code: '1001', name: 'أحمد محمد علي' }, { student_code: '1002', name: 'سارة علي حسن' }];
        assert.equal(matchStudent(noId, '1001', 'سارة علي حسن').method, 'code_name_conflict');
        assert.equal(suggestPossibleMatches({ extractedName: 'علي' }, noId).length, 2);
    });

    it('prepareRoster: numeric / Arabic-digit codes become comparable strings', () => {
        const r = prepareRoster([{ student_code: 1001, name: 'أحمد' }, { student_code: '٢٠٠٢', name: 'سارة' }]);
        assert.equal(matchStudent(r, '1001', 'أحمد').method, 'code_exact');
        assert.equal(matchStudent(r, '2002', 'سارة').method, 'code_exact');
    });

    it('prepareRoster + normalizePhone: +20 / 0020 / 20 / missing-0 formats all match 010...', () => {
        for (const stored of ['+201000000001', '00201000000001', '201000000001', '1000000001', '010-0000-0001']) {
            const r = prepareRoster([{ student_code: '1', name: 'أحمد', phone: stored }, { student_code: '2', name: 'سارة', phone: '01111111111' }]);
            assert.equal(matchStudent(r, '9999', '', normalizePhone('٠١٠٠٠٠٠٠٠٠١')).method, 'phone_unique', stored);
        }
    });

    it('normalizePhone leaves non-Egyptian-mobile numbers as plain digits', () => {
        assert.equal(normalizePhone('0225551234'), '0225551234');
        assert.equal(normalizePhone(''), '');
    });
});
