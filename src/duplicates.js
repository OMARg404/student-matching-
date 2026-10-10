'use strict';
/**
 * Duplicate-paper detection: "this student already has a result for this exam".
 * A new paper is a duplicate of an existing result for the SAME exam if:
 *   - both are matched to the same student, OR
 *   - the extracted name is exactly the same text, OR
 *   - the extracted code is exactly the same text.
 * (The two "extracted" checks catch the same paper photographed twice even when it never matched.)
 *
 * @param {Array<{id, exam_id, student_id?, extracted_name?, extracted_code?}>} existingResults
 * @param {{exam_id, student_id?, extracted_name?, extracted_code?}} incoming
 * @returns {object|null} the existing result it duplicates, or null
 */
function findDuplicate(existingResults, incoming) {
    return existingResults.find((r) =>
        r.exam_id === incoming.exam_id && (
            (incoming.student_id && r.student_id === incoming.student_id) ||
            (incoming.extracted_name && r.extracted_name === incoming.extracted_name) ||
            (incoming.extracted_code && r.extracted_code === incoming.extracted_code)
        )
    ) || null;
}

module.exports = { findDuplicate };
