'use strict';
/**
 * Arabic text normalization used everywhere a name, code or phone is compared or searched.
 *
 * Two levels exist on purpose (both are used in production today):
 *
 *  1. normalizeAr(s)        — the "search" normalizer. Aggressive: it folds every common
 *                             spelling variant of an Arabic name into one form, so a person
 *                             typing "مى" finds "مي", "عبد الله" finds "عبدالله", etc.
 *                             Used by: search, possible-match suggestions.
 *
 *  2. normalizeNameWords(s) — the "matching" normalizer. Lighter: folds alef/yaa/taa-marbuta
 *                             only, then splits into words and drops 1-letter words.
 *                             Used by: nameMatchScore (the core matching algorithm).
 *
 * normalizeDigits(s) turns Arabic-Indic digits (٠-٩) into Latin digits (0-9). Students often
 * write their code/phone in Arabic digits, and Arabic mobile keyboards type them too.
 */

const ARABIC_DIGITS_RE = /[٠-٩]/g;

function normalizeDigits(s) {
    return String(s ?? '').replace(ARABIC_DIGITS_RE, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Search normalizer.
 *  - lower-case, Arabic digits -> Latin
 *  - removes tashkeel (diacritics) and tatweel (ـ)
 *  - أ إ آ ٱ -> ا ,  ى -> ي ,  ة -> ه ,  ؤ -> و ,  ئ -> ي
 *  - ذ -> ز ,  ث -> س ,  ظ -> ض   (very common handwriting / colloquial swaps in Egypt)
 *  - punctuation -> space
 *  - repeated LETTERS collapse to one ("عاادل" -> "عادل"); digits are NOT collapsed ("1001" stays)
 *  - "عبد ال..." / "ابو ..." / "بو ..." are glued to the next word ("عبد الله" -> "عبدالله")
 */
function normalizeAr(s) {
    return normalizeDigits(s)
        .toLowerCase()
        .replace(/[ً-ْٰـ]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
        .replace(/ذ/g, 'ز').replace(/ث/g, 'س').replace(/ظ/g, 'ض')
        .replace(/[.\-_,،/()؛;:!؟?"'«»…]/g, ' ')
        .replace(/(\D)\1+/g, '$1')
        .replace(/(^|\s)(عبد|ابو|بو)\s+(?=\S)/g, '$1$2')
        .replace(/\s+/g, ' ').trim();
}

/**
 * A 1–2 letter query must match the START of a word (otherwise "مي" would match the middle
 * of "سامي", "الكيمياء", ... and results look random). A leading "ال" is ignored, so "مي"
 * still finds "الميزان". Longer queries always pass this filter.
 * @param {string} nq - query already passed through normalizeAr
 * @param {string} text - raw text to test
 */
function shortQueryMatches(nq, text) {
    if (nq.length > 2) return true;
    return normalizeAr(text).split(' ').some((w) => w.startsWith(nq) || (w.startsWith('ال') && w.slice(2).startsWith(nq)));
}

/**
 * Matching normalizer: light letter folding + split into words of length >= 2.
 * Works for Arabic and Latin names alike.
 * @returns {string[]}
 */
function normalizeNameWords(s) {
    return (s || '').toString().trim().toLowerCase()
        .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
        .replace(/[^a-z0-9؀-ۿ\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2);
}

/**
 * Egyptian mobile -> one local format "01XXXXXXXXX".
 * "+201000000001", "00201000000001", "201000000001", "1000000001", "010 0000 0001", "٠١٠٠٠٠٠٠٠٠١" -> "01000000001".
 * Anything that doesn't look like an Egyptian mobile is returned as cleaned digits, unchanged otherwise.
 */
function normalizePhone(s) {
    const d = normalizeDigits(s).replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0020') && d.length === 14) return '0' + d.slice(4);
    if (d.startsWith('20') && d.length === 12) return '0' + d.slice(2);
    if (d.startsWith('1') && d.length === 10) return '0' + d;
    return d;
}

/**
 * Run your students through this ONCE (when loading / when the table changes), not per request.
 * The algorithm compares codes and phones with ===, so both sides must be in the same form:
 *   - student_code -> string, Arabic digits -> Latin, no spaces/dashes   (1001 and "١٠٠١" -> "1001")
 *   - phone        -> normalizePhone (+20 / 0020 / 20 / missing 0 -> "01...")
 * Every other field is kept as is.
 */
function prepareRoster(students) {
    return students.map((s) => ({
        ...s,
        student_code: normalizeIdentifier(s.student_code),
        phone: s.phone === null || s.phone === undefined || s.phone === '' ? '' : normalizePhone(s.phone)
    }));
}

/** Code / phone cleanup: Arabic digits -> Latin, trim, and drop spaces/dashes inside. */
function normalizeIdentifier(s) {
    if (s === null || s === undefined) return '';
    return normalizeDigits(s).trim().replace(/[\s\-]/g, '');
}

module.exports = { normalizeAr, shortQueryMatches, normalizeNameWords, normalizeDigits, normalizeIdentifier, normalizePhone, prepareRoster };
