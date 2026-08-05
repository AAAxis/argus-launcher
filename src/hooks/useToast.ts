import {useCallback, useEffect, useState} from 'react';

export type ErrorDialog = {title: string; detail: string};

// How loudly the status line should read. 'info' is the default and the one
// every plain setMessage() gets, so the ~90 existing call sites keep the neutral
// banner they were written for.
export type ToastTone = 'info' | 'ok' | 'fail';

export type Toast = {
  message: string;
  tone: ToastTone;
  // The raw text behind a result, offered as a copy button on the toast itself.
  // A proxy check's error is the case this exists for: it is the one string
  // worth pasting into a provider's support chat, and it used to be readable
  // for five seconds and then gone.
  detail: string;
  setMessage: (message: string) => void;
  // A toast that is not just neutral news. Same banner, plus a coloured glyph
  // and -- when `detail` is given -- a copy button.
  notify: (message: string, options?: {tone?: ToastTone; detail?: string}) => void;
  // Same, but takes the updater form so a handler can clear only its own
  // message and leave someone else's alone.
  updateMessage: (update: (current: string) => string) => void;
  errorDialog: ErrorDialog | null;
  setErrorDialog: (dialog: ErrorDialog | null) => void;
  // The pair used by every "this failed and the user must read why" path: the
  // transient toast is cleared so it cannot compete with the modal.
  fail: (title: string, detail: string) => void;
};

type Notice = {message: string; tone: ToastTone; detail: string};

const QUIET: Notice = {message: '', tone: 'info', detail: ''};

// How long a toast stays up. A failure gets longer because it is the only one
// with something to do about it: a five-second window to notice a red banner,
// read the error and reach the copy button is a button that is gone by the time
// the cursor arrives.
const DISMISS_MS = 5000;
const DISMISS_FAIL_MS = 14000;

// The app-wide status line and the blocking error dialog. Kept together because
// they are two halves of one decision -- whether a result is worth interrupting
// for -- and every call site that raises the dialog also has to clear the toast.
export function useToast(): Toast {
  const [notice, setNotice] = useState<Notice>(QUIET);
  const [errorDialog, setErrorDialog] = useState<ErrorDialog | null>(null);

  // Identity-stable, because useNativeState lists them as effect dependencies
  // and a new function each render would re-run that effect on every render.
  const setMessage = useCallback(
      (message: string) => setNotice({...QUIET, message}), []);

  const notify = useCallback(
      (message: string, options: {tone?: ToastTone; detail?: string} = {}) =>
        setNotice({message, tone: options.tone || 'info', detail: options.detail || ''}),
      []);

  // Only the text changes: an updater is amending a message already on screen,
  // not raising a new one, so it must not silently reset the tone under it.
  const updateMessage = useCallback(
      (update: (current: string) => string) =>
        setNotice((current) => ({...current, message: update(current.message)})),
      []);

  const fail = useCallback((title: string, detail: string) => {
    setNotice(QUIET);
    setErrorDialog({title, detail});
  }, []);

  // Auto-dismiss the floating status-toast after a few seconds -- as an
  // inline footer this never needed a timer, but a floating corner banner
  // that never clears would sit there forever after the last action.
  useEffect(() => {
    if (!notice.message) {
      return;
    }
    const timer = setTimeout(
        () => setNotice(QUIET),
        notice.tone === 'fail' ? DISMISS_FAIL_MS : DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice.message, notice.tone]);

  return {
    message: notice.message,
    tone: notice.tone,
    detail: notice.detail,
    setMessage,
    notify,
    updateMessage,
    errorDialog,
    setErrorDialog,
    fail,
  };
}
