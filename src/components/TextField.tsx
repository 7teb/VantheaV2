import { useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { class_names } from "./class-names.ts";
import "./TextField.css";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: string;
  on_change: (value: string) => void;
  icon?: ReactNode;
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
};

export const TextField = ({ value, on_change, icon, trailing, className, type = "text", spellCheck = false, ...rest }: TextFieldProps) => (
  <label className={class_names("text-field", "inset-surface", className)}>
    {icon && <span className="text-field-icon">{icon}</span>}
    <input
      type={type}
      className="text-field-input"
      value={value}
      spellCheck={spellCheck}
      onChange={(event) => on_change(event.target.value)}
      {...rest}
    />
    {trailing}
  </label>
);

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string;
  on_change: (value: string) => void;
  auto_grow?: boolean;
  max_height?: number;
};

export const TextArea = ({ value, on_change, auto_grow = false, max_height = 320, className, spellCheck = false, ...rest }: TextAreaProps) => {
  const element = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = element.current;
    if (!auto_grow || !node) {
      return;
    }
    node.style.height = "auto";
    if (value === "") {
      return;
    }
    node.style.height = `${Math.min(node.scrollHeight, max_height)}px`;
  }, [auto_grow, max_height, value]);

  return (
    <textarea
      ref={element}
      className={class_names("text-area", "inset-surface", auto_grow && "is-auto-grow", className)}
      value={value}
      spellCheck={spellCheck}
      style={auto_grow ? { maxHeight: max_height } : undefined}
      onChange={(event) => on_change(event.target.value)}
      {...rest}
    />
  );
};
