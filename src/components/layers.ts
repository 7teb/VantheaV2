type Layer = { id: number; close: () => void };

const stack: Layer[] = [];

let next_id = 0;

export const push_layer = (close: () => void): (() => void) => {
  const layer = { id: ++next_id, close };
  stack.push(layer);
  return () => {
    const index = stack.findIndex((entry) => entry.id === layer.id);
    if (index !== -1) {
      stack.splice(index, 1);
    }
  };
};

export const close_top_layer = (): boolean => {
  const top = stack.at(-1);
  if (!top) {
    return false;
  }
  top.close();
  return true;
};

export const layer_count = () => stack.length;
