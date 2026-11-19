export const SECTIONS = [
  { id: "reservations", label: "Reservations", href: "/" },
  { id: "our-story", label: "Our story", href: "/our-story/" },
  { id: "the-menu", label: "The menu", href: "/the-menu/" },
  { id: "the-experience", label: "The experience", href: "/the-experience/" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];
