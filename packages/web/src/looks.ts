import officeParty from "./assets/landing-party.webp";
import beach from "./assets/looks/beach-christmas.webp";
import beachThumb from "./assets/looks/beach-christmas-thumb.webp";
import claymation from "./assets/looks/claymation-christmas.webp";
import claymationThumb from "./assets/looks/claymation-christmas-thumb.webp";
import fireside from "./assets/looks/fireside.webp";
import firesideThumb from "./assets/looks/fireside-thumb.webp";
import gingerbread from "./assets/looks/gingerbread.webp";
import gingerbreadThumb from "./assets/looks/gingerbread-thumb.webp";
import gala from "./assets/looks/golden-gala.webp";
import galaThumb from "./assets/looks/golden-gala-thumb.webp";
import lodge from "./assets/looks/snowy-mountain-lodge.webp";
import lodgeThumb from "./assets/looks/snowy-mountain-lodge-thumb.webp";
import officePartyThumb from "./assets/looks/office-party-thumb.webp";
import neon from "./assets/looks/retro-80s-neon.webp";
import neonThumb from "./assets/looks/retro-80s-neon-thumb.webp";
import sweater from "./assets/looks/ugly-sweater.webp";
import sweaterThumb from "./assets/looks/ugly-sweater-thumb.webp";
import winterNight from "./assets/looks/winter-night.webp";
import winterNightThumb from "./assets/looks/winter-night-thumb.webp";

/**
 * A ready-made Theme the app comes with: a background image and the two colors that go with it, for a Host
 * without a look of their own. The page color is the image's overall tone (dark for a dark image), since it's what
 * headings sitting on the image are made readable against; the main color is the one that pops from it.
 */
export type Look = { id: string; name: string; image: string; thumb: string; color: string; page: string };

export const LOOKS: Look[] = [
  { id: "office-party", name: "Office party", image: officeParty, thumb: officePartyThumb, color: "#b3202e", page: "#f6f4f1" },
  { id: "fireside", name: "Fireside", image: fireside, thumb: firesideThumb, color: "#a3262a", page: "#2b1a0f" },
  { id: "ugly-sweater", name: "Ugly sweater", image: sweater, thumb: sweaterThumb, color: "#0f5a3c", page: "#f3e9dc" },
  { id: "claymation", name: "Claymation", image: claymation, thumb: claymationThumb, color: "#c0392b", page: "#e3eef3" },
  { id: "gingerbread", name: "Gingerbread", image: gingerbread, thumb: gingerbreadThumb, color: "#8a4b22", page: "#3a2416" },
  { id: "winter-night", name: "Winter night", image: winterNight, thumb: winterNightThumb, color: "#2b5d8a", page: "#15263b" },
  { id: "mountain-lodge", name: "Mountain lodge", image: lodge, thumb: lodgeThumb, color: "#2e6b46", page: "#1a1f33" },
  { id: "golden-gala", name: "Golden gala", image: gala, thumb: galaThumb, color: "#b8913a", page: "#1c1813" },
  { id: "beach-christmas", name: "Beach Christmas", image: beach, thumb: beachThumb, color: "#c8553d", page: "#f6e6d6" },
  { id: "retro-80s", name: "Retro '80s", image: neon, thumb: neonThumb, color: "#d6338f", page: "#140a33" },
];
