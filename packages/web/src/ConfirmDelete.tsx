import { useState } from "react";

/** Asks before something is deleted for good (or ended, first), under the row it's about; No changes nothing. */
export function ConfirmDelete({
  question,
  yes,
  no = "Keep it",
  onYes,
  onNo,
}: {
  question: string;
  yes: string;
  no?: string;
  onYes: () => Promise<boolean>;
  onNo: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="confirm-delete">
      <p>{question}</p>
      <div className="inline">
        <button className="danger-solid" onClick={() => void onYes().then((ok) => setFailed(!ok))}>
          {yes}
        </button>
        <button className="secondary" onClick={onNo}>
          {no}
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
