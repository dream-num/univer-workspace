# Add records from an HTML page

Use `window.univerBinding.insertRowsWithValues()` for registration, intake and other forms that add
records to an existing worksheet. Inspect the actual column layout and choose an insertion position
that fits the source. With a header in row 1, `startRow: 1` inserts beneath it and moves older records
down. This avoids scanning for an empty row and overwriting it with independent scalar writes.

## Parameters

```ts
interface HtmlInsertRowsWithValuesParams {
  unitId: string;
  sheetId: string;
  startRow: number;
  rowCount: number;
  startColumn: number;
  values: (string | number | boolean | null)[][];
}
```

IDs are raw, unencoded IDs. Coordinates are zero-based non-negative safe integers; `rowCount` is a
positive safe integer. `startRow` can equal the worksheet's current row count to append, but cannot
exceed it. The page API has no method to query that row count or atomically choose the latest end.
Do not equate the last populated record with the worksheet's row count.

`values` must be a non-empty rectangular matrix with at least one column and no more than
`rowCount` rows. Values are literal strings, finite numbers, booleans or `null` blanks. The matrix
starts at `startColumn` in the inserted rows; its width must fit the worksheet's existing columns.
Unfilled new cells remain blank. Columns are not automatically added. Arguments are checked before
mutation, and inserting and filling the rows uses one synchronous SDK command.

## Registration example

This example expects a worksheet with a header row and columns A:D for registration ID, name,
registration time and check-in status. Replace the Unit and Sheet IDs and adapt the columns to the
inspected source. The form keeps an inserted record pending until saving is confirmed, so a failed
save retries `flush()` rather than inserting the same record again.

```html
<form id="registration">
  <label>姓名 <input id="attendee-name" required></label>
  <button id="submit-registration" type="submit">提交报名</button>
</form>
<p id="registration-result" role="status"></p>
<script type="module">
  const binding = window.univerBinding;
  const form = document.querySelector('#registration');
  const nameInput = document.querySelector('#attendee-name');
  const button = document.querySelector('#submit-registration');
  const result = document.querySelector('#registration-result');
  let pendingRecordId = null;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const name = nameInput.value.trim();
    if (!pendingRecordId && !name) {
      result.textContent = '请输入姓名';
      return;
    }
    button.disabled = true;
    nameInput.readOnly = true;
    try {
      if (!pendingRecordId) {
        const recordId = crypto.randomUUID();
        await binding.insertRowsWithValues({
          unitId: 'REAL_UNIT_ID',
          sheetId: 'REAL_SHEET_ID',
          startRow: 1,
          rowCount: 1,
          startColumn: 0,
          values: [[recordId, name, new Date().toISOString(), '未签到']],
        });
        pendingRecordId = recordId;
      }
      await binding.flush();
      result.textContent = `报名已保存，编号：${pendingRecordId}`;
      pendingRecordId = null;
      form.reset();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.textContent = pendingRecordId
        ? `记录已插入，保存尚未确认：${message}。请重试保存。`
        : `提交未确认：${message}。重新提交前请核对来源表是否已有记录。`;
    } finally {
      button.disabled = false;
      button.textContent = pendingRecordId ? '重试保存' : '提交报名';
      nameInput.readOnly = pendingRecordId !== null;
    }
  });
</script>
```

The returned Promise confirms local execution; `flush()` waits for collaboration acknowledgement.
Keep user input on failure. A lost connection can make an operation's outcome uncertain; inspect the
source before submitting again. The example's pending flag is local page state, not durable
idempotency across reloads. Insertion does not enforce unique emails, capacities or other business
rules across concurrent users.

## Update lists and check-in pages

Use `subscribeRange` to refresh lists or charts. Updates contain the full current matrix. Inserting
rows does not enlarge a subscribed range or move a cell binding along with its previous record.
Choose an inspected range suitable for the view, and retain a stable record ID in each displayed
record. Re-read and locate that ID before writing check-in status; sorting, filtering or newly
inserted rows can invalidate an old row index. Reading an ID and then writing its row is still not
an atomic update-by-ID operation under concurrent structural edits.

Verify this template using the main Skill's template checks and `univer_html_view validate`.
Validation does not execute the insertion handler or verify runtime saving.
