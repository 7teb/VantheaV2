import type { NoteLine, OutcomeNote } from "./review-notes.ts";
import "./ReviewNote.css";

export const ReviewLines = ({ lines }: { lines: NoteLine[] }) => (
  <div className="review-lines">
    {lines.map((entry, index) => (
      <div key={index} className="review-line" data-tone={entry.tone}>
        {entry.text}
      </div>
    ))}
  </div>
);

export const ReviewNotice = ({ note }: { note: OutcomeNote }) => (
  <div className="review-notice">
    <div className="review-notice-title">{note.title}</div>
    {note.lines.map((entry, index) => (
      <div key={index} className="review-notice-line" data-tone={entry.tone}>
        {entry.text}
      </div>
    ))}
  </div>
);
