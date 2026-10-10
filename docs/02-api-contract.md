# 02 — عقد الـAPI (المطلوب منكم)

endpoint‏ين. التطبيق الشغال في [`examples/server.js`](../examples/server.js). أي تعديل في أسماء الحقول أو المسارات يناسبكم، قولوا.

- **Base URL**: بتاعكم.
- **Auth**: `Authorization: Bearer <token>` على كل الطلبات — إنتو اللي بتولّدوا التوكن.
- **Content-Type**: `application/json; charset=utf-8`.
- **مهلة الرد**: لحد **10 ثواني**.

---

## 1) `POST /v1/papers/match` — طابق ورقة

### الطلب

```json
{
  "request_id": "res_8f2a91c0",
  "exam": { "id": "exam_51b0e7aa", "name": "امتحان الباب الأول", "form": "A" },
  "extracted": {
    "student_code": "1001",
    "student_name": "احمد محمد",
    "student_phone": null
  }
}
```

| الحقل | إلزامي | |
|---|---|---|
| `request_id` | ✔️ | معرّف الورقة عندنا — بيرجع زي ما هو في الرد عشان نربط الرد بالورقة |
| `exam.id` | ✔️ | معرّف الامتحان عندنا |
| `exam.name`, `exam.form` | | للعرض/السجل |
| `extracted.*` | واحد على الأقل | أي حقل ممكن يكون `null` |

`validateMatchRequest` في [`src/api.js`](../src/api.js) بتنضّف القيم: أرقام عربي ← إنجليزي (`١٠٠١` ← `1001`)، المسافات والشرَط جوه الكود/التليفون بتتشال، والنص الفاضي = `null`.

### الرد — `200 OK` (لأي ورقة اتعالجت، حتى لو الطالب مش موجود)

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

| الحقل | |
|---|---|
| `status` | `matched` \| `needs_review` \| `conflict` \| `not_found` |
| `method` | القاعدة اللي طلّعت القرار — [01](01-matching-algorithm.md) |
| `review_recommended` | `true` لأي حاجة مش `matched`، وكمان لـ`matched` اللي اتصحح تلقائي (`code_one_digit_off`، `phone_unique`) |
| `student` | الطالب — في `matched` بس |
| `suggested_student` | اقتراح واحد محتاج تأكيد — في `name_only` |
| `candidates` | لحد 5 مرشحين. في `conflict` بالظبط 2 ومعاهم `reason: "code" \| "name"` |
| `note_ar` | شرح عربي جاهز للعرض |

`student_code` اللي بترجّعوه هو اللي الدرجة هتتبعتلكم بيه بعدين، فلازم يكون **ثابت** للطالب.

### الحالات بأمثلة

**matched (بالتليفون)**
```json
{ "status": "matched", "method": "phone_unique", "review_recommended": true,
  "student": { "student_code": "2052", "name": "مي عادل إبراهيم", "group": "...", "year": "..." },
  "candidates": [],
  "note_ar": "مطابقة تلقائية برقم الهاتف: الكود المستخرج لم يتطابق مع أي طالب، لكن رقم الهاتف (01100000005) يطابق \"مي عادل إبراهيم\" حصريًا. اتأكدت تلقائيًا - يُفضّل مراجعة سريعة." }
```

**needs_review (الاسم بس)**
```json
{ "status": "needs_review", "method": "name_only", "review_recommended": true,
  "student": null,
  "suggested_student": { "student_code": "3107", "name": "يوسف خالد عبد الله", "group": "أونلاين", "year": "تالتة ثانوي" },
  "candidates": [ { "student_code": "3107", "name": "يوسف خالد عبد الله", "group": "أونلاين", "year": "تالتة ثانوي", "reason": null } ],
  "note_ar": "اتطابق بالاسم بس. الكود المسجّل في قاعدة البيانات هو 3107. من فضلك أكّد!" }
```

**conflict (اشتباه بين طالبين)**
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

## 2) `GET /v1/students/search?q=...&limit=10` — بحث يدوي

خانة واحدة: **اسم أو جزء من اسم، أو كود أو جزء من كود**.

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

- `limit`: من 1 لـ50، الافتراضي 10. `total` = كل النتايج قبل القص.
- الترتيب: كود مطابق بالظبط ← أكواد فيها الجزء ده ← أسماء (بحث متسامح مع الأخطاء بعد التوحيد العربي) — [`src/search.js`](../src/search.js).
- أرقام عربي شغالة (`٢٠٥٢`).

---

## الأخطاء

```json
{ "error": { "code": "MISSING_FIELD", "field": "exam.id", "message": "exam.id is required" } }
```

| HTTP | `error.code` | السبب |
|---|---|---|
| 400 | `INVALID_JSON` | الجسم مش JSON |
| 400 | `MISSING_FIELD` | `request_id` / `exam.id` / `q` ناقص |
| 400 | `NOTHING_EXTRACTED` | الكود والاسم والتليفون كلهم فاضيين |
| 401 | `UNAUTHORIZED` | التوكن ناقص أو غلط |
| 404 | `NOT_FOUND` | endpoint غلط |
| 413 | `PAYLOAD_TOO_LARGE` | الطلب أكبر من 64KB |
| 429 | `RATE_LIMITED` | لو عندكم حد للطلبات (مع `Retry-After`) |
| 5xx | `INTERNAL_ERROR` | أي خطأ عندكم |

لأي 429 / 5xx / timeout بنعيد الطلب. المطابقة مفيهاش أي حالة بتتخزن عندكم، فإعادة نفس الطلب بترجع نفس الرد.

---

## اختياري: دفعة واحدة

`POST /v1/papers/match:batch` بـ `{ "papers": [ <نفس جسم الطلب>, ... ] }` (لحد 100) والرد `{ "results": [ <نفس جسم الرد>, ... ] }` بنفس الترتيب. مش لازم للبداية.
