'use strict';
/**
 * THE student-matching algorithm.
 *
 * Same logic, rule order and thresholds as the algorithm used in grading. `method` is a
 * machine-readable label for WHICH rule produced the decision; `matchNote` is the Arabic
 * human-readable explanation.
 *
 * Input:  the full student roster + whatever the AI read off the paper (code, name, phone).
 * Output: { matchedStudent, status, method, matchNote, candidates? }
 *
 *   status = 'matched'   -> safe to attach the mark to this student automatically
 *   status = 'unmatched' -> a human must look at it. matchedStudent may still be set: that's
 *                           a SUGGESTION to confirm (e.g. a name-only match), not a decision.
 *
 * Pure function: no I/O, no clock, no randomness. Same input -> same output.
 * See docs/03-matching-algorithm.md for the full explanation with worked examples.
 */
const { normalizeNameWords, normalizeAr } = require('./normalize');

/** A name match "counts as strong" from this many matching words upward. */
const STRONG_NAME_MATCH_THRESHOLD = 2;

/**
 * How many words of the extracted name appear in the real name.
 * A word "appears" if either word contains the other: "محمد" ~ "محمدي", "عبد" ~ "عبدالله" count,
 * "احمد" vs "محمود" does not. This keeps small handwriting/OCR differences acceptable without
 * accepting unrelated names. Words shorter than 2 letters are ignored (see normalizeNameWords).
 * @returns {number} 0..(number of extracted words)
 */
function nameMatchScore(extractedName, actualName) {
    const extractedWords = normalizeNameWords(extractedName);
    const actualWords = normalizeNameWords(actualName);
    if (!extractedWords.length || !actualWords.length) return 0;

    let score = 0;
    for (const w of extractedWords) {
        if (actualWords.some((a) => a.includes(w) || w.includes(a))) score++;
    }
    return score;
}

/** "Is this name at least plausibly the same person?" = at least one word in common. */
function namesPlausiblyMatch(extractedName, actualName) {
    return nameMatchScore(extractedName, actualName) > 0;
}

/** Exactly one character differs between two codes of the same length (one digit misread). */
function isOneDigitOff(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) diff++;
        if (diff > 1) return false;
    }
    return diff === 1;
}

/**
 * @param {Array<{name: string, student_code: string, phone?: string}>} students - pass them through
 *        prepareRoster() first (src/normalize.js): codes must be strings, phones in one format
 * @param {string|null} extractedCode
 * @param {string|null} extractedName
 * @param {string|null} [extractedPhone]
 * @returns {{
 *   matchedStudent: object|null,
 *   status: 'matched'|'unmatched',
 *   method: 'code_exact'|'code_one_digit_off'|'phone_unique'|'code_name_conflict'|'code_name_mismatch'|'name_only'|'none',
 *   matchNote: string|null,
 *   candidates?: Array<{student: object, reason: 'code'|'name'}>
 * }}
 */
function matchStudent(students, extractedCode, extractedName, extractedPhone) {
    const extractedNameTrimmed = (extractedName || '').toString().trim();
    const extractedPhoneTrimmed = (extractedPhone || '').toString().trim();
    const studentByCode = extractedCode ? students.find((s) => s.student_code === extractedCode) : null;

    // RULE A — code is one digit off from exactly ONE student, and the name agrees -> trust it.
    if (!studentByCode && extractedCode && extractedNameTrimmed) {
        const nearMissCandidates = students.filter((s) => s.student_code && isOneDigitOff(extractedCode, s.student_code));
        if (nearMissCandidates.length === 1) {
            const candidate = nearMissCandidates[0];
            if (namesPlausiblyMatch(extractedNameTrimmed, candidate.name)) {
                return {
                    matchedStudent: candidate,
                    status: 'matched',
                    method: 'code_one_digit_off',
                    matchNote: `مطابقة تلقائية بالتقارب: الكود المستخرج (${extractedCode}) قريب بفارق خانة واحدة من كود "${candidate.name}" (${candidate.student_code})، والاسم المستخرج ("${extractedNameTrimmed}") يرشّحه. اتأكدت تلقائيًا - يُفضّل مراجعة سريعة.`
                };
            }
        }
    }

    // RULE B — still no code match: the phone matches exactly ONE student -> trust it.
    if (!studentByCode && extractedPhoneTrimmed) {
        const phoneMatches = students.filter((s) => s.phone && s.phone.toString().trim() === extractedPhoneTrimmed);
        if (phoneMatches.length === 1) {
            return {
                matchedStudent: phoneMatches[0],
                status: 'matched',
                method: 'phone_unique',
                matchNote: `مطابقة تلقائية برقم الهاتف: الكود المستخرج لم يتطابق مع أي طالب، لكن رقم الهاتف (${extractedPhoneTrimmed}) يطابق "${phoneMatches[0].name}" حصريًا. اتأكدت تلقائيًا - يُفضّل مراجعة سريعة.`
            };
        }
    }

    // RULE C — exact code match. Cross-check with the name, if a name was read.
    if (studentByCode) {
        if (!extractedNameTrimmed) {
            return { matchedStudent: studentByCode, status: 'matched', method: 'code_exact', matchNote: null };
        }

        const codeOwnerScore = nameMatchScore(extractedNameTrimmed, studentByCode.name);
        const bestConflict = students
            .filter((s) => s !== studentByCode) // by object, so it works whatever your id field is called
            .map((s) => ({ student: s, score: nameMatchScore(extractedNameTrimmed, s.name) }))
            .filter((c) => c.score >= STRONG_NAME_MATCH_THRESHOLD && c.score > codeOwnerScore)
            .sort((a, b) => b.score - a.score)[0];

        // C1 — the name points STRONGLY and MORE to a different student -> real conflict (2 students).
        if (bestConflict) {
            return {
                matchedStudent: null,
                status: 'unmatched',
                method: 'code_name_conflict',
                matchNote: `تعارض: الكود المستخرج بيخص "${studentByCode.name}"، لكن الاسم المستخرج بيطابق طالب تاني هو "${bestConflict.student.name}" بشكل أقوى. يحتاج مراجعة وتأكيد يدوي.`,
                candidates: [
                    { student: studentByCode, reason: 'code' },
                    { student: bestConflict.student, reason: 'name' }
                ]
            };
        }
        // C2 — name agrees with the code owner (at least one word) -> matched.
        if (codeOwnerScore > 0) {
            return { matchedStudent: studentByCode, status: 'matched', method: 'code_exact', matchNote: null };
        }
        // C3 — code exists but the name has nothing to do with its owner -> human review.
        return {
            matchedStudent: null,
            status: 'unmatched',
            method: 'code_name_mismatch',
            matchNote: `الكود المستخرج (${extractedCode}) بيخص "${studentByCode.name}"، لكن الاسم المستخرج من الورقة ("${extractedNameTrimmed}") مش قريب من الاسم ده خالص. يحتاج مراجعة وتأكيد يدوي.`
        };
    }

    // RULE D — no code match at all: best name match, ONLY if it clearly beats the runner-up.
    // Never auto-confirmed: returned as a suggestion (status stays 'unmatched').
    if (extractedNameTrimmed) {
        const ranked = students
            .map((s) => ({ student: s, score: nameMatchScore(extractedNameTrimmed, s.name) }))
            .filter((c) => c.score > 0)
            .sort((a, b) => b.score - a.score);
        const best = ranked[0];
        const runnerUp = ranked[1];
        if (best && (!runnerUp || best.score > runnerUp.score)) {
            return {
                matchedStudent: best.student,
                status: 'unmatched',
                method: 'name_only',
                matchNote: `اتطابق بالاسم بس. الكود المسجّل في قاعدة البيانات هو ${best.student.student_code}. من فضلك أكّد!`
            };
        }
    }

    // RULE E — nothing usable.
    return { matchedStudent: null, status: 'unmatched', method: 'none', matchNote: null };
}

/**
 * Up to 5 "possible matches" shown to the human reviewer next to an unmatched paper.
 * 1) if the algorithm produced explicit candidates (conflict) -> those, in that order;
 * 2) otherwise: everyone with the exact extracted code + everyone whose normalized name
 *    contains (or is contained in) the normalized extracted name.
 */
function suggestPossibleMatches({ extractedCode, extractedName, candidates }, students, limit = 5) {
    if (candidates && candidates.length) {
        return candidates.map((c) => ({ ...c.student, reason: c.reason }));
    }
    const suggestions = new Map();
    if (extractedCode) {
        students.filter((s) => s.student_code === extractedCode).forEach((s) => suggestions.set(s, s));
    }
    if (extractedName) {
        const needle = normalizeAr(extractedName);
        if (needle) {
            students.filter((s) => { const n = normalizeAr(s.name); return n && (n.includes(needle) || needle.includes(n)); })
                .forEach((s) => suggestions.set(s, s));
        }
    }
    return Array.from(suggestions.values()).slice(0, limit);
}

module.exports = {
    matchStudent,
    suggestPossibleMatches,
    nameMatchScore,
    namesPlausiblyMatch,
    isOneDigitOff,
    STRONG_NAME_MATCH_THRESHOLD
};
