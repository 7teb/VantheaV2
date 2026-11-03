export const PreviewText = ({ text, prompt = "" }: { text: string; prompt?: string }) => (
  <div className="command-card-command">
    <pre className="command-card-text approval-preview-text">
      {prompt && <span className="command-card-prompt">{prompt}</span>}
      {text}
    </pre>
  </div>
);
