# 02 — API contract (what you need to provide)

Two endpoints. A working implementation is in [`examples/server.js`](../examples/server.js). If different field names or paths suit you better, tell us.

- **Base URL**: yours.
- **Auth**: `Authorization: Bearer <token>` on every request — you generate the token.
- **Content-Type**: `application/json; charset=utf-8`.
- **Timeout**: we wait up to **10 seconds** for a response.

---

## 1) `POST /v1/papers/match` — match one paper

### Request

```json
{
  "request_id": "res_8f2a91c0",
  "exam": { "id": "exam_51b0e7aa", "name": "Chapter 1 exam", "form": "A" },
  "extracted": {
    "student_code": "1001",
    "student_name": "احمد محمد",
    "student_phone": null
  }
}
```

| Field | Required | |
|---|---|---|
| `request_id` | ✔️ | Our ID for the paper — returned unchanged in the response so we can link the response to the paper |
| `exam.id` | ✔️ | Our ID for the exam |
| `exam.name`, `exam.form` | | For display / logging |
| `extracted.*` | at least one | Any field may be `null` |

`validateMatchRequest` in [`src/api.js`](../src/api.js) cleans the values: Arabic digits → Latin (`١٠٠١` → `1001`), spaces and dashes inside the code are removed, the phone is normalized to `01XXXXXXXXX`, and an empty string becomes `null`. (The same normalization must be applied to your data with `prepareRoster` — see [01](01-matching-algorithm.md#input-data).)

### Response — `200 OK` (for every processed paper, even when the student is not found)

```json
{
  "request_id": "res_8f2a91c0",
  "status": "matched",
  "method": "code_exact",
  "review_recommended": false,
  "student": { "student_code": "1001", "name": "أحمد محمد علي", "group": "مجموعة السبت 4م", "year": "تالتة ثانوي" },
  "suggested_student": null,
  "candidates": [],
  "note_ar": null
}
```

| Field | |
|---|---|
| `status` | `matched` \| `needs_review` \| `conflict` \| `not_found` |
| `method` | The rule that produced the decision — see [01](01-matching-algorithm.md) |
| `review_recommended` | `true` for anything that is not `matched`, and also for a `matched` that was auto-corrected (`code_one_digit_off`, `phone_unique`) |
| `student` | The student — only when `matched` |
| `suggested_student` | A single suggestion that must be confirmed — only for `name_only` |
| `candidates` | Up to 5 candidates. For `conflict`, exactly 2, each with `reason: "code" \| "name"` |
| `note_ar` | Arabic explanation, ready to show to the reviewer |

The `student_code` you return is the one the mark will be sent back with later, so it must be **stable** for that student.

### Examples of each status

Abbreviated — `request_id` and any field not shown are present as in the full response above.

**matched (by phone)**
```json
{ "status": "matched", "method": "phone_unique", "review_recommended": true,
  "student": { "student_code": "2052", "name": "مي عادل إبراهيم", "group": "...", "year": "..." },
  "candidates": [],
  "note_ar": "مطابقة تلقائية برقم الهاتف: الكود المستخرج لم يتطابق مع أي طالب، لكن رقم الهاتف (01100000005) يطابق \"مي عادل إبراهيم\" حصريًا. اتأكدت تلقائيًا - يُفضّل مراجعة سريعة." }
```

**needs_review (name only)**
```json
{ "status": "needs_review", "method": "name_only", "review_recommended": true,
  "student": null,
  "suggested_student": { "student_code": "3107", "name": "يوسف خالد عبد الله", "group": "أونلاين", "year": "تالتة ثانوي" },
  "candidates": [ { "student_code": "3107", "name": "يوسف خالد عبد الله", "group": "أونلاين", "year": "تالتة ثانوي", "reason": null } ],
  "note_ar": "اتطابق بالاسم بس. الكود المسجّل في قاعدة البيانات هو 3107. من فضلك أكّد!" }
```

**conflict (two possible students)**
```json
{ "status": "conflict", "method": "code_name_conflict", "review_recommended": true,
  "student": null,
  "candidates": [
    { "student_code": "1001", "name": "أحمد محمد علي", "reason": "code", "group": "...", "year": "..." },
    { "student_code": "1002", "name": "سارة علي حسن", "reason": "name", "group": "...", "year": "..." }
  ],
  "note_ar": "تعارض: الكود المستخرج بيخص \"أحمد محمد علي\"، لكن الاسم المستخرج بيطابق طالب تاني هو \"سارة علي حسن\" بشكل أقوى. يحتاج مراجعة وتأكيد يدوي." }
```

**not_found**
```json
{ "status": "not_found", "method": "none", "review_recommended": true,
  "student": null, "suggested_student": null, "candidates": [], "note_ar": null }
```

---

## 2) `GET /v1/students/search?q=...&limit=10` — manual search

One search box: **a name or part of a name, or a code or part of a code**.

```
GET /v1/students/search?q=مى%20عادل&limit=10
```

```json
{
  "query": "مى عادل",
  "total": 1,
  "results": [ { "student_code": "2052", "name": "مي عادل إبراهيم", "group": "مجموعة الاتنين 2م", "year": "تانية ثانوي" } ]
}
```

- `limit`: 1 to 50, default 10. `total` = number of results before the limit is applied.
- Order: exact code match → codes containing the query → names (typo-tolerant search after Arabic normalization) — see [`src/search.js`](../src/search.js).
- Arabic digits work (`٢٠٥٢`).

---

## Errors

```json
{ "error": { "code": "MISSING_FIELD", "field": "exam.id", "message": "exam.id is required" } }
```

| HTTP | `error.code` | Cause |
|---|---|---|
| 400 | `INVALID_JSON` | The body is not valid JSON |
| 400 | `MISSING_FIELD` | `request_id` / `exam.id` / `q` is missing |
| 400 | `NOTHING_EXTRACTED` | Code, name and phone are all empty |
| 401 | `UNAUTHORIZED` | Missing or wrong token |
| 404 | `NOT_FOUND` | Unknown endpoint |
| 413 | `PAYLOAD_TOO_LARGE` | Request larger than 64 KB |
| 429 | `RATE_LIMITED` | If you rate-limit requests (send `Retry-After`) |
| 5xx | `INTERNAL_ERROR` | Any error on your side |

On 429 / 5xx / timeout we retry the request. Matching stores nothing on your side, so sending the same request again returns the same response.

---

## Optional: batch

`POST /v1/papers/match:batch` with `{ "papers": [ <same request body>, ... ] }` (up to 100), responding `{ "results": [ <same response body>, ... ] }` in the same order. Not needed to start, and not implemented in the reference server.
