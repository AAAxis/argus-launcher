import {useEffect, useState} from 'react';

export type ErrorDialog = {title: string; detail: string};

export type Toast = {
  message: string;
  setMessage: (message: string) => void;
  // Same, but takes the updater form so a handler can clear only its own
  // message and leave someone else's alone.
  updateMessage: (update: (current: string) => string) => void;
  errorDialog: ErrorDialog | null;
  setErrorDialog: (dialog: ErrorDialog | null) => void;
  // The pair used by every "this failed and the user must read why" path: the
  // transient toast is cleared so it cannot compete with the modal.
  fail: (title: string, detail: string) => void;
};

// The app-wide status line and the blocking error dialog. Kept together because
// they are two halves of one decision -- whether a result is worth interrupting
// for -- and every call site that raises the dialog also has to clear the toast.
export function useToast(): Toast {
  const [message, setMessage] = useState('');
  const [errorDialog, setErrorDialog] = useState<ErrorDialog | null>(null);

  // Auto-dismiss the floating status-toast after a few seconds -- as an
  // inline footer this never needed a timer, but a floating corner banner
  // that never clears would sit there forever after the last action.
  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  return {
    message,
    setMessage,
    updateMessage: setMessage,
    errorDialog,
    setErrorDialog,
    fail: (title, detail) => {
      setMessage('');
      setErrorDialog({title, detail});
    },
  };
}
