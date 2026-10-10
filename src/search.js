'use strict';
/**
 * Manual student search ("ابحث بالاسم أو بالكود") — what the reviewer uses when the automatic
 * match failed or needs correcting. Same logic as production.
 *
 * One search box, two kinds of query handled together:
 *   - CODE: exact code first, then every code that CONTAINS the query (type part of a code,
 *     get all students whose code includes it). Codes are identifiers -> no fuzzy/typo matching.
 *   - NAME: fuzzy (typo-tolerant) search with Fuse.js over the Arabic-normalized name
 *     (threshold 0.4 = tolerates 1–2 wrong letters without returning unrelated names).
 *     1–2 letter queries must match the start of a word (see shortQueryMatches).
 * Order of results: exact code -> partial codes -> name matches. No student appears twice.
 */
const Fuse = require('fuse.js');
const { normalizeAr, shortQueryMatches, normalizeDigits } = require('./normalize');

const FUSE_OPTIONS = {
    keys: ['name'],
    threshold: 0.4,
    ignoreLocation: true,
    getFn: (obj, path) => normalizeAr(Fuse.config.getFn(obj, path))
};

// Building the Fuse index is the expensive part (~13k students in production). Cache it per
// roster array identity: same array -> same index; a new array (roster changed) -> new index.
const fuseByStudents = new WeakMap();
function getFuse(students) {
    let fuse = fuseByStudents.get(students);
    if (!fuse) { fuse = new Fuse(students, FUSE_OPTIONS); fuseByStudents.set(students, fuse); }
    return fuse;
}

/**
 * @param {Array<{name: string, student_code: string}>} students
 * @param {string} query - a name, part of a name, a code or part of a code (Arabic digits OK)
 * @returns {Array<object>} students, best first
 */
function searchStudents(students, query) {
    const q = (query || '').trim();
    if (!q || !Array.isArray(students) || students.length === 0) return [];

    const code = normalizeDigits(q);
    const qLower = code.toLowerCase();
    const exactCodeMatch = students.find((s) => s.student_code === code);
    const partialCodeMatches = students.filter((s) =>
        s.student_code && s.student_code.toLowerCase().includes(qLower) && s.student_code !== code
    );

    const nq = normalizeAr(q);
    const fuzzyMatches = nq
        ? getFuse(students).search(nq).map((r) => r.item).filter((s) => shortQueryMatches(nq, s.name))
        : [];

    const ordered = [...(exactCodeMatch ? [exactCodeMatch] : []), ...partialCodeMatches, ...fuzzyMatches];
    const seen = new Set();
    return ordered.filter((s) => {
        if (seen.has(s.student_code)) return false;
        seen.add(s.student_code);
        return true;
    });
}

module.exports = { searchStudents };
