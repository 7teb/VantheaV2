import { ChevronUpIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";

type TodoFoldProps = { count: number; walked: boolean; open: boolean; grow: boolean; on_toggle: () => void };

export const TodoFold = ({ count, walked, open, grow, on_toggle }: TodoFoldProps) => {
  const t = use_t();
  const stubs = Array.from({ length: Math.min(count, 4) }, (_, index) => <i key={index} />);
  return (
    <button type="button" className="todo-fold" aria-expanded={open} data-grow={grow || undefined} onClick={on_toggle}>
      <span className="todo-fold-stubs" data-walked={walked || undefined} data-more={count > 4 || undefined}>
        {stubs}
      </span>
      <span className="todo-fold-label">{open ? t("tools.todo_earlier_hide") : t("tools.todo_earlier", { n: count })}</span>
      <ChevronUpIcon className="todo-fold-chevron" />
    </button>
  );
};
