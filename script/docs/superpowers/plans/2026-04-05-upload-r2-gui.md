# upload_r2 GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PySide6 desktop GUI for `upload_r2.py` with grouped parameter controls at the top, a start button, and split R2/Linux log panes at the bottom while preserving the existing CLI entry point.

**Architecture:** Keep `upload_r2.py` as the upload engine and add a callable runtime layer that accepts parsed options plus a log callback instead of printing directly. Add a separate `upload_r2_gui.py` file that owns the PySide6 window, starts a worker thread, routes `[R2]` and `[LINUX]` log lines into separate panes, and updates a status label from thread-safe Qt signals.

**Tech Stack:** Python 3.13, PySide6, boto3, paramiko, unittest

---

## File Map

- `upload_r2.py` — modify to extract a GUI-callable execution function, centralize message emission, and keep `main()` delegating to that function.
- `upload_r2_gui.py` — create the PySide6 desktop application, worker object, signal wiring, grouped form layout, and split log panels.
- `requirements.txt` — modify to add `PySide6` alongside existing runtime dependencies.
- `tests/test_upload_r2.py` — modify to add tests for the new callable execution layer and callback-based logging.

## Notes

- The current directory is not a git repository, so this plan uses verification checkpoints instead of commit steps.
- Keep the existing CLI behavior intact: `python upload_r2.py ...` must still work after the GUI refactor.
- The GUI should call the upload engine in-process on a background thread, not shell out to a subprocess.
- Do not rewrite upload behavior. Only restructure it enough to be reusable from the GUI.

### Task 1: Add PySide6 dependency and a callable upload entry point

**Files:**
- Modify: `requirements.txt`
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:387-731`

- [ ] **Step 1: Write the failing test for callback-based execution**

Append this to `tests/test_upload_r2.py`:

```python
from argparse import Namespace
from tempfile import TemporaryDirectory
```

```python
class RunUploadTests(unittest.TestCase):
    def test_run_upload_logs_no_files_message_through_callback(self):
        with TemporaryDirectory() as tmpdir:
            messages = []
            args = Namespace(
                dir=tmpdir,
                bucket=None,
                prefix=upload_r2.DEFAULT_PREFIX,
                endpoint=None,
                region=None,
                env_file=None,
                recursive=False,
                workers=1,
                no_skip_existing=False,
                dry_run=False,
                target='r2',
                linux_host=None,
                linux_user=None,
                linux_dir=None,
                linux_key=None,
                linux_password=None,
                linux_port=22,
            )

            exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(exit_code, 0)
        self.assertEqual(messages, [f'No image files found in {Path(tmpdir).resolve()}'])
```

- [ ] **Step 2: Run the test and verify it fails because `run_upload` does not exist yet**

Run:

```bash
python -m unittest discover -v
```

Expected: `ERROR` mentioning `module 'upload_r2' has no attribute 'run_upload'`.

- [ ] **Step 3: Add `PySide6` to runtime dependencies**

Update `requirements.txt` to:

```txt
boto3
paramiko
PySide6
```

- [ ] **Step 4: Install the updated dependencies**

Run:

```bash
python -m pip install -r requirements.txt
```

Expected: pip reports `Successfully installed PySide6 ...` or `Requirement already satisfied` for all three packages.

- [ ] **Step 5: Extract the callable upload runner and message emitter**

In `upload_r2.py`, add this helper near `format_result_message()`:

```python
def emit_message(message: str, log_callback=None, *, stream=None) -> None:
    if log_callback is not None:
        log_callback(message)
        return
    print(message, file=stream or sys.stdout)
```

Then replace `main()` with a thin wrapper over a new `run_upload(args, log_callback=None)` function. The new function should contain the current body of `main()` after `parser.parse_args(argv)` and swap every `print(...)` for `emit_message(...)`. For stderr cases, use:

```python
emit_message('Missing R2 endpoint. Set --endpoint, R2_ENDPOINT, or CLOUDFLARE_ACCOUNT_ID.', log_callback, stream=sys.stderr)
```

and for regular output use:

```python
emit_message(f'Found {len(files)} image file(s) in {folder}', log_callback)
```

Finally, keep `main()` as:

```python
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Upload local images to Cloudflare R2 and a Linux server.')
    parser.add_argument('--dir', default='.', help='Folder to scan. Defaults to current directory.')
    parser.add_argument('--bucket', default=None, help='Target bucket name.')
    parser.add_argument('--prefix', default=DEFAULT_PREFIX, help='Object key prefix. Defaults to gallery.')
    parser.add_argument('--endpoint', default=None, help='R2 S3 endpoint.')
    parser.add_argument('--region', default=None, help='Signing region. Defaults to auto.')
    parser.add_argument('--env-file', default=None, help='Load variables from a local config file, e.g. .env.')
    parser.add_argument('--recursive', action='store_true', help='Scan subdirectories recursively.')
    parser.add_argument('--workers', type=int, default=16, help='Parallel uploads. Defaults to 16.')
    parser.add_argument('--no-skip-existing', action='store_true', help='Upload even if the target object already exists.')
    parser.add_argument('--dry-run', action='store_true', help='List upload targets without sending requests.')
    parser.add_argument('--target', choices=('r2', 'linux', 'both'), default='both', help='Upload target. Defaults to both.')
    parser.add_argument('--linux-host', default=None, help='Linux server hostname or IP.')
    parser.add_argument('--linux-user', default=None, help='Linux server SSH user.')
    parser.add_argument('--linux-dir', default=None, help='Target directory on Linux server.')
    parser.add_argument('--linux-key', default=None, help='SSH private key path for Linux server uploads.')
    parser.add_argument('--linux-password', default=None, help='SSH password for Linux server uploads.')
    parser.add_argument('--linux-port', type=int, default=22, help='SSH port for Linux server uploads. Defaults to 22.')
    args = parser.parse_args(argv)
    return run_upload(args)
```

- [ ] **Step 6: Run the test again and verify it passes**

Run:

```bash
python -m unittest discover -v
```

Expected: the new `RunUploadTests` test passes along with the existing tests.

### Task 2: Route runtime logs through the new callback layer

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:491-730`

- [ ] **Step 1: Write the failing test for R2/Linux log forwarding**

Append this to `tests/test_upload_r2.py`:

```python
class RunUploadLogRoutingTests(unittest.TestCase):
    def test_run_upload_emits_prefixed_results_to_callback(self):
        with TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / 'image.png'
            image_path.write_bytes(b'png-bytes')
            messages = []
            args = Namespace(
                dir=tmpdir,
                bucket=None,
                prefix=upload_r2.DEFAULT_PREFIX,
                endpoint='https://example.r2.cloudflarestorage.com',
                region='auto',
                env_file=None,
                recursive=False,
                workers=1,
                no_skip_existing=False,
                dry_run=True,
                target='both',
                linux_host='host',
                linux_user='user',
                linux_dir='/remote',
                linux_key='key.pem',
                linux_password=None,
                linux_port=22,
            )

            with patch.object(upload_r2, 'list_existing_keys', return_value=(set(), None)):
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(exit_code, 0)
        self.assertTrue(any(msg.startswith('[R2] DRY-RUN image.png') for msg in messages))
        self.assertTrue(any(msg.startswith('[LINUX] DRY-RUN image.png') for msg in messages))
        self.assertTrue(messages[-1].startswith('Finished. Dry-run: 2, Failed: 0'))
```

- [ ] **Step 2: Run the test and verify it fails because the current implementation still prints directly in one or more branches**

Run:

```bash
python -m unittest discover -v
```

Expected: `FAIL` because `messages` is missing the prefixed per-target lines or final summary.

- [ ] **Step 3: Route every status line through `emit_message()`**

In `upload_r2.py`, update all output sites inside `run_upload(...)` so they call `emit_message(...)` instead of `print(...)`, including:

```python
emit_message(format_result_message('linux', message), log_callback)
emit_message(format_result_message(target_label, message), log_callback)
emit_message(f'Finished. Uploaded: {uploaded_count}, Skipped: {skipped_count}, Failed: {fail_count}', log_callback)
```

Do this for:
- the linux-password branch
- the `both` + password branch
- the normal thread-pool branch
- both summary lines (`dry-run` and upload)

- [ ] **Step 4: Run the full test suite and verify all runtime tests pass**

Run:

```bash
python -m unittest discover -v
```

Expected: all tests from Task 1 and Task 2 pass.

### Task 3: Build the PySide6 window and worker thread

**Files:**
- Create: `upload_r2_gui.py`
- Modify: `requirements.txt`

- [ ] **Step 1: Write the failing smoke test for log routing helpers**

Append this to `tests/test_upload_r2.py`:

```python
class GuiLogRoutingTests(unittest.TestCase):
    def test_split_target_from_message_identifies_r2_and_linux(self):
        from upload_r2_gui import split_target_from_message

        self.assertEqual(split_target_from_message('[R2] OK file.png'), ('r2', '[R2] OK file.png'))
        self.assertEqual(split_target_from_message('[LINUX] OK file.png'), ('linux', '[LINUX] OK file.png'))
        self.assertEqual(split_target_from_message('Finished. Uploaded: 1, Skipped: 0, Failed: 0'), ('status', 'Finished. Uploaded: 1, Skipped: 0, Failed: 0'))
```

- [ ] **Step 2: Run the test and verify it fails because `upload_r2_gui.py` does not exist yet**

Run:

```bash
python -m unittest discover -v
```

Expected: `ERROR` mentioning `No module named 'upload_r2_gui'`.

- [ ] **Step 3: Create the GUI file with the worker, routing helper, and window skeleton**

Create `upload_r2_gui.py` with this structure:

```python
import sys
from argparse import Namespace

from PySide6.QtCore import QObject, QThread, Signal, Slot
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QPushButton,
    QPlainTextEdit,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

import upload_r2


def split_target_from_message(message: str) -> tuple[str, str]:
    if message.startswith('[R2]'):
        return 'r2', message
    if message.startswith('[LINUX]'):
        return 'linux', message
    return 'status', message


class UploadWorker(QObject):
    log_message = Signal(str)
    finished = Signal(int)
    failed = Signal(str)

    def __init__(self, args: Namespace):
        super().__init__()
        self.args = args

    @Slot()
    def run(self):
        try:
            exit_code = upload_r2.run_upload(self.args, log_callback=self.log_message.emit)
            self.finished.emit(exit_code)
        except Exception as exc:
            self.failed.emit(str(exc))
```

Then continue in the same file with a `MainWindow(QMainWindow)` that:
- creates a central widget with a vertical layout
- adds a top `QLabel` status line
- adds three `QGroupBox` sections (`基础参数`, `R2 参数`, `Linux 参数`) in a `QGridLayout`
- adds a `QPushButton('启动上传')`
- adds two `QPlainTextEdit` widgets in a bottom `QHBoxLayout`
- makes both log widgets read-only

Use these exact control fields:
- 基础参数: `dir_input`, `env_file_input`, `target_combo`, `workers_spin`, `recursive_checkbox`, `dry_run_checkbox`, `skip_existing_checkbox`
- R2 参数: `bucket_input`, `prefix_input`, `endpoint_input`, `region_input`
- Linux 参数: `linux_host_input`, `linux_user_input`, `linux_dir_input`, `linux_key_input`, `linux_password_input`, `linux_port_spin`

Also add:
- `r2_log`
- `linux_log`
- `status_label`
- `start_button`

Implement `_build_args()` to return:

```python
Namespace(
    dir=self.dir_input.text() or '.',
    bucket=self.bucket_input.text() or None,
    prefix=self.prefix_input.text() or upload_r2.DEFAULT_PREFIX,
    endpoint=self.endpoint_input.text() or None,
    region=self.region_input.text() or None,
    env_file=self.env_file_input.text() or None,
    recursive=self.recursive_checkbox.isChecked(),
    workers=self.workers_spin.value(),
    no_skip_existing=not self.skip_existing_checkbox.isChecked(),
    dry_run=self.dry_run_checkbox.isChecked(),
    target=self.target_combo.currentText(),
    linux_host=self.linux_host_input.text() or None,
    linux_user=self.linux_user_input.text() or None,
    linux_dir=self.linux_dir_input.text() or None,
    linux_key=self.linux_key_input.text() or None,
    linux_password=self.linux_password_input.text() or None,
    linux_port=self.linux_port_spin.value(),
)
```

Implement `_start_upload()` so it:
- clears both logs
- sets status to `运行中`
- disables `start_button`
- creates `QThread()` and `UploadWorker(...)`
- moves worker to the thread
- connects `thread.started -> worker.run`
- connects `worker.log_message -> _handle_log_message`
- connects `worker.finished -> _handle_finished`
- connects `worker.failed -> _handle_failed`
- starts the thread

Implement `_handle_log_message(message)` so it uses `split_target_from_message()` and appends to:
- `r2_log` for `r2`
- `linux_log` for `linux`
- `status_label.setText(payload)` for `status`

Implement `_handle_finished(exit_code)` so it:
- sets status text to `完成` if `exit_code == 0` else `失败`
- re-enables `start_button`
- quits and cleans the thread

Implement `_handle_failed(error_text)` so it:
- sets status text to `失败: <error_text>`
- appends the error text to both logs
- re-enables `start_button`
- quits and cleans the thread

Finish the file with:

```python
def main() -> int:
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == '__main__':
    raise SystemExit(main())
```

- [ ] **Step 4: Run the full test suite and verify the new helper test passes**

Run:

```bash
python -m unittest discover -v
```

Expected: the `GuiLogRoutingTests` test passes along with the previous tests.

### Task 4: Verify the GUI wiring and preserve CLI behavior

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`
- Modify: `upload_r2_gui.py`

- [ ] **Step 1: Write the failing test for `MainWindow._build_args()`**

Append this to `tests/test_upload_r2.py`:

```python
class GuiBuildArgsTests(unittest.TestCase):
    def test_main_window_build_args_maps_form_state_to_namespace(self):
        from PySide6.QtWidgets import QApplication
        from upload_r2_gui import MainWindow

        app = QApplication.instance() or QApplication([])
        window = MainWindow()
        window.dir_input.setText('C:/images')
        window.env_file_input.setText('.env.local')
        window.target_combo.setCurrentText('both')
        window.workers_spin.setValue(8)
        window.recursive_checkbox.setChecked(True)
        window.dry_run_checkbox.setChecked(True)
        window.skip_existing_checkbox.setChecked(True)
        window.bucket_input.setText('bucket-a')
        window.prefix_input.setText('gallery-x')
        window.endpoint_input.setText('https://example.r2.cloudflarestorage.com')
        window.region_input.setText('auto')
        window.linux_host_input.setText('host-a')
        window.linux_user_input.setText('user-a')
        window.linux_dir_input.setText('/srv/images')
        window.linux_key_input.setText('id_rsa')
        window.linux_password_input.setText('secret')
        window.linux_port_spin.setValue(2022)

        args = window._build_args()

        self.assertEqual(args.dir, 'C:/images')
        self.assertEqual(args.env_file, '.env.local')
        self.assertEqual(args.target, 'both')
        self.assertEqual(args.workers, 8)
        self.assertTrue(args.recursive)
        self.assertTrue(args.dry_run)
        self.assertFalse(args.no_skip_existing)
        self.assertEqual(args.bucket, 'bucket-a')
        self.assertEqual(args.prefix, 'gallery-x')
        self.assertEqual(args.endpoint, 'https://example.r2.cloudflarestorage.com')
        self.assertEqual(args.region, 'auto')
        self.assertEqual(args.linux_host, 'host-a')
        self.assertEqual(args.linux_user, 'user-a')
        self.assertEqual(args.linux_dir, '/srv/images')
        self.assertEqual(args.linux_key, 'id_rsa')
        self.assertEqual(args.linux_password, 'secret')
        self.assertEqual(args.linux_port, 2022)
```

- [ ] **Step 2: Run the test and verify it fails until `_build_args()` is implemented exactly**

Run:

```bash
python -m unittest discover -v
```

Expected: `FAIL` or `ERROR` in `test_main_window_build_args_maps_form_state_to_namespace`.

- [ ] **Step 3: Adjust the GUI until `_build_args()` and start-button wiring satisfy the test and design**

If the prior skeleton did not already match the exact names or behavior, fix `upload_r2_gui.py` so:
- `_build_args()` matches the `Namespace(...)` contract exactly
- `skip_existing_checkbox` defaults to checked
- `target_combo` contains exactly `r2`, `linux`, `both`
- `workers_spin` minimum is `1`, default is `16`
- `linux_port_spin` minimum is `1`, default is `22`
- the status label defaults to `空闲`
- both log panes are read-only and titled through surrounding labels or group boxes

- [ ] **Step 4: Run the full test suite and verify all tests pass**

Run:

```bash
python -m unittest discover -v
```

Expected: all tests pass.

- [ ] **Step 5: Verify the CLI still works after the refactor**

Run:

```bash
python upload_r2.py --target r2 --dry-run --workers 1 --dir .
```

Expected: the script prints the same summary style as before and ends with `Finished. Dry-run: ... , Failed: 0`.

- [ ] **Step 6: Launch the GUI as a manual smoke test**

Run:

```bash
python upload_r2_gui.py
```

Expected: a window opens showing:
- top status label
- grouped `基础参数` / `R2 参数` / `Linux 参数`
- `启动上传` button near the top controls
- bottom split logs for R2 and Linux

Close the window manually after confirming the layout.
