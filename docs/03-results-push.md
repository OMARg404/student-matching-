# 03 — The marks you will receive

After grading, marks are sent to you automatically at a URL you choose. We need from you: **the URL + a token**.

## When a paper is sent

Only when the student is **confirmed** (`matched`, or confirmed during review) and the whole paper was read. A paper that still needs review on our side is **not sent**.

## Request

```
POST <your URL>
Authorization: Bearer <your token>
Content-Type: application/json
```

```json
{
  "exam_name": "Chapter 1 exam",
  "exam_id": "exam_51b0e7aa",
  "batch_id": "b-exam_51b0e7aa-1791234567890-0",
  "source": "scanner",
  "results": [
    { "student_id": "1001", "student_name": "أحمد محمد علي", "mark": 18, "full_mark": 20 },
    { "student_id": "2052", "student_name": "مي عادل إبراهيم", "mark": 15.5, "full_mark": 20 }
  ]
}
```

| Field | |
|---|---|
| `exam_name`, `exam_id` | The exam (the same `exam.id` as in the match request) |
| `batch_id` | Unique ID of this batch (a string — don't rely on its format) |
| `source` | Always `"scanner"` (photographed paper) |
| `results[].student_id` | **The student code** (`student_code`) — the one you returned in the match response, or the one picked from your search |
| `results[].student_name` | Student name |
| `results[].mark` / `full_mark` | Mark and maximum mark (can be fractional, e.g. 15.5) |

- One request per exam, with **at most 500 students** per request — larger sets are split, each part with its own `batch_id`.

## Expected response

- Any **`2xx`** = received (the body is ignored).
- Anything else, or no response within **45 seconds** = failure → we retry automatically until it succeeds.

## Important on your side

**Treat (`exam_id` + `student_id`) as a unique key**: if the same student in the same exam arrives again (a retry, or the paper was re-graded), **update** the mark instead of adding a new row.
