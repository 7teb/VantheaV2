export type Invoke<A extends unknown[], R> = { readonly kind: "invoke"; readonly args?: A; readonly result?: R };

export type Send<A extends unknown[]> = { readonly kind: "send"; readonly args?: A };

export type Emit<P> = { readonly kind: "event"; readonly payload?: P };

export const invoke = <A extends unknown[], R>(): Invoke<A, R> => ({ kind: "invoke" });

export const send = <A extends unknown[]>(): Send<A> => ({ kind: "send" });

export const emit = <P>(): Emit<P> => ({ kind: "event" });
