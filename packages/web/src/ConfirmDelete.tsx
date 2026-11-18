import { useState } from "react";

/** Asks before something is deleted for good, under the row it's about: Yes deletes, Keep it changes nothing. */
export function ConfirmDelete({ question, yes, onYes, onNo }: { question: string; yes: string; onYes: () => Promise<boolean>; onNo: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="confirm-delete">
      <p>{question}</p>
      <div className="inline">
        <button className="danger-solid" onClick={() => void onYes().then((ok) => setFailed(!ok))}>
          {yes}
        </button>
        <button className="secondary" onClick={onNo}>
          Keep it
        </button>
      </div>
      {failed && (
        <p className="error" role="alert">
          That didn't work. Please try again.
        </p>
      )}
    </div>
  );
}
