import type { ReactNode } from "react";

export type AgentBloom = { key: string; body: ReactNode };

const turns = (count: number, step: number, petal: (transform: string | undefined, index: number) => ReactNode) =>
  Array.from({ length: count }, (_, index) => petal(index === 0 ? undefined : `rotate(${index * step} 12 12)`, index));

const cross_petal = "M12 12C14.9 9.6 15.1 5.3 12 2.5C8.9 5.3 9.1 9.6 12 12Z";

const pinwheel_petal = "M12 12C10 8.5 10.5 4 14 2.8C16.8 6 15.8 10 12 12Z";

const compass_star = "M12 2.5C12.7 8.3 15.7 11.3 21.5 12C15.7 12.7 12.7 15.7 12 21.5C11.3 15.7 8.3 12.7 2.5 12C8.3 11.3 11.3 8.3 12 2.5Z";

const seeds = [
  [12, 4],
  [17.66, 6.34],
  [20, 12],
  [17.66, 17.66],
  [12, 20],
  [6.34, 17.66],
  [4, 12],
  [6.34, 6.34],
];

export const agent_blooms: AgentBloom[] = [
  {
    key: "trefoil",
    body: (
      <>
        <circle cx="12" cy="7.7" r="4.6" />
        <circle cx="15.72" cy="14.15" r="4.6" />
        <circle cx="8.28" cy="14.15" r="4.6" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    key: "cross",
    body: (
      <>
        {turns(4, 90, (transform, index) => (
          <path key={index} d={cross_petal} transform={transform} />
        ))}
        <circle cx="12" cy="12" r="2.2" />
      </>
    ),
  },
  {
    key: "five",
    body: (
      <>
        {turns(5, 72, (transform, index) => (
          <ellipse key={index} cx="12" cy="6.6" rx="3.3" ry="4.4" transform={transform} />
        ))}
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    key: "daisy",
    body: (
      <>
        {turns(8, 45, (transform, index) => (
          <ellipse key={index} cx="12" cy="5.8" rx="1.7" ry="3.9" transform={transform} />
        ))}
        <circle cx="12" cy="12" r="3.1" />
      </>
    ),
  },
  {
    key: "asterisk",
    body: <path d="M12 3.5v17M4.64 7.75l14.72 8.5M4.64 16.25l14.72-8.5" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" />,
  },
  {
    key: "pinwheel",
    body: (
      <>
        {turns(4, 90, (transform, index) => (
          <path key={index} d={pinwheel_petal} transform={transform} />
        ))}
        <circle cx="12" cy="12" r="1.8" />
      </>
    ),
  },
  {
    key: "compass",
    body: (
      <>
        <path d={compass_star} />
        <path d={compass_star} transform="translate(12 12) rotate(45) scale(.6) translate(-12 -12)" />
      </>
    ),
  },
  {
    key: "seed_head",
    body: (
      <>
        {seeds.map(([cx, cy]) => (
          <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="1.75" />
        ))}
        <circle cx="12" cy="12" r="3.4" />
      </>
    ),
  },
];
